// ==UserScript==
// @name         NBNT: 新版百度网盘共享文件库目录导出工具
// @namespace    http://tampermonkey.net/
// @version      0.264
// @description  用于导出百度网盘共享文件库目录和文件列表
// @author       UJiN
// @license      MIT
// @match        https://pan.baidu.com/disk*
// @icon         https://nd-static.bdstatic.com/m-static/v20-main/favicon-main.ico
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    let directories = []; // 存储解析后的目录数据
    let depthSetting = 1; // 默认层数设置

    // 添加并发控制池
    class RequestPool {
        constructor(maxConcurrent = 2, requestInterval = 3000) {
            this.maxConcurrent = maxConcurrent;
            this.currentRequests = 0;
            this.queue = [];
            this.requestInterval = requestInterval;
            this.lastRequestTime = 0;
        }

        async add(fn) {
            if (this.currentRequests >= this.maxConcurrent) {
                await new Promise(resolve => this.queue.push(resolve));
            }

            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            if (timeSinceLastRequest < this.requestInterval) {
                await new Promise(resolve =>
                    setTimeout(resolve, this.requestInterval - timeSinceLastRequest)
                );
            }

            this.currentRequests++;
            this.lastRequestTime = Date.now();

            try {
                return await fn();
            } finally {
                this.currentRequests--;
                if (this.queue.length > 0) {
                    const next = this.queue.shift();
                    next();
                }
            }
        }
    }

    // 添加进度条组件
    function createProgressBar() {
        const progressContainer = document.createElement('div');
        progressContainer.id = 'directory-progress';
        progressContainer.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 9999;
            display: none;
            min-width: 300px;
            font-family: "Microsoft YaHei", sans-serif;
        `;

        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = `
            font-weight: bold;
            margin-bottom: 15px;
            color: #333;
            font-size: 14px;
        `;
        titleDiv.textContent = '目录获取进度';

        const progressText = document.createElement('div');
        progressText.id = 'progress-text';
        progressText.style.cssText = `
            margin-bottom: 10px;
            color: #666;
            font-size: 13px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 280px;
        `;
        progressText.textContent = '正在获取目录信息...';

        const progressBarOuter = document.createElement('div');
        progressBarOuter.style.cssText = `
            width: 100%;
            height: 6px;
            background: #f0f0f0;
            border-radius: 3px;
            overflow: hidden;
        `;

        const progressBarInner = document.createElement('div');
        progressBarInner.id = 'progress-bar';
        progressBarInner.style.cssText = `
            width: 0%;
            height: 100%;
            background: linear-gradient(90deg, #2196F3, #00BCD4);
            transition: width 0.3s ease;
            border-radius: 3px;
        `;

        progressBarOuter.appendChild(progressBarInner);
        progressContainer.appendChild(titleDiv);
        progressContainer.appendChild(progressText);
        progressContainer.appendChild(progressBarOuter);
        document.body.appendChild(progressContainer);

        return {
            show: () => progressContainer.style.display = 'block',
            hide: () => progressContainer.style.display = 'none',
            updateProgress: (current, total) => {
                const percentage = Math.min((current / total) * 100, 100);
                progressBarInner.style.width = `${percentage}%`;
                progressText.textContent = `进度：${current}/${total} (${percentage.toFixed(1)}%)`;
            },
            updateText: (text) => {
                progressText.textContent = text;
            }
        };
    }

    // 等待文件库按钮和标题加载，并添加点击事件监听
    function waitForLibraryElements() {
        let isProcessing = false;

        // 检查并添加按钮到操作栏
        function checkAndAddOperationButtons() {
            if (isProcessing) return;
            isProcessing = true;

            try {
                // 修改选择器以匹配按钮出现的时机
                const operateDiv = document.querySelector('.im-file-nav__operate');
                const downloadButton = operateDiv?.querySelector('.u-icon-download')?.closest('button');
                
                // 如果找不到必要元素，快速返回
                if (!operateDiv || !downloadButton) {
                    isProcessing = false;
                    return;
                }

                const existingCheckButton = document.querySelector('#check-dir-button');
                const existingFetchButton = document.querySelector('#fetch-dir-button');
                
                // 如果按钮已存在，快速返回
                if (existingCheckButton || existingFetchButton) {
                    isProcessing = false;
                    return;
                }

                console.log("找到操作栏，添加按钮...");
                
                // 创建检查按钮
                const checkButton = document.createElement('button');
                checkButton.id = 'check-dir-button';
                checkButton.type = 'button';
                checkButton.className = 'u-button u-button--default u-button--mini';
                checkButton.innerHTML = `
                    <i class="u-icon-search"></i>
                    <span>检查目录</span>
                `;
                
                // 创建获取按钮
                const fetchButton = document.createElement('button');
                fetchButton.id = 'fetch-dir-button';
                fetchButton.type = 'button';
                fetchButton.className = 'u-button u-button--default u-button--mini';
                fetchButton.innerHTML = `
                    <i class="u-icon-folder"></i>
                    <span>导出目录</span>
                `;

                // 创建获取全部按钮
                const fetchAllButton = document.createElement('button');
                fetchAllButton.id = 'fetch-all-button';
                fetchAllButton.type = 'button';
                fetchAllButton.className = 'u-button u-button--default u-button--mini';
                fetchAllButton.innerHTML = `
                    <i class="u-icon-download-bold"></i>
                    <span>导出全部</span>
                `;

                // 添加点击事件
                checkButton.onclick = function() {
                    const selected = getSelectedDirectory();
                    if (!selected) {
                        alert('请选中一个目录!');
                        return;
                    }
                    const { dirInfo, title } = selected;
                    checkDirectoryInfo(dirInfo.msg_id, title);
                };

                fetchButton.onclick = async function() {
                    const selected = getSelectedDirectory();
                    if (!selected) {
                        alert('请选中一个目录!');
                        return;
                    }

                    const { dirInfo, title } = selected;
                    console.log("选中的目录信息:", dirInfo);

                    const uk = dirInfo.uk;
                    const fsId = dirInfo.fs_id;
                    const gid = dirInfo.group_id;
                    const msgId = dirInfo.msg_id;

                    depthSetting = parseInt(prompt("请输入要获取的子目录层数:", "1"), 10);
                    if (isNaN(depthSetting) || depthSetting < 1) {
                        alert("请输入有效的层数！");
                        return;
                    }

                    const result = await fetchSubdirectories(uk, msgId, fsId, gid, title, depthSetting);
                    console.log("获取的目录结构：", result);
                    saveAsTxt(result.tree, title);
                };

                fetchAllButton.onclick = async function() {
                    const selected = getSelectedDirectory();
                    if (!selected) {
                        alert('请选中一个目录!');
                        return;
                    }

                    const { dirInfo, title } = selected;
                    console.log("选中的目录信息:", dirInfo);

                    const uk = dirInfo.uk;
                    const fsId = dirInfo.fs_id;
                    const gid = dirInfo.group_id;
                    const msgId = dirInfo.msg_id;

                    depthSetting = parseInt(prompt("请输入要获取的层数:", "1"), 10);
                    if (isNaN(depthSetting) || depthSetting < 1) {
                        alert("请输入有效的层数！");
                        return;
                    }

                    const result = await fetchAllContent(uk, msgId, fsId, gid, title, depthSetting);
                    console.log("获取的完整结构：", result);
                    saveAsTxt(result.tree, title + "_完整");
                };

                // 使用 requestAnimationFrame 来优化按钮插入时机
                requestAnimationFrame(() => {
                    downloadButton.after(fetchAllButton);
                    downloadButton.after(fetchButton);
                    downloadButton.after(checkButton);
                });

            } finally {
                isProcessing = false;
            }
        }

        // 创建一个防抖函数
        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }

        // 使用防抖包装检查函数
        const debouncedCheck = debounce(checkAndAddOperationButtons, 200);

        // 修改 MutationObserver 的配置
        const observer = new MutationObserver((mutations) => {
            // 只在有相关变化时触发检查
            const hasRelevantChanges = mutations.some(mutation => {
                return mutation.addedNodes.length > 0 && 
                       Array.from(mutation.addedNodes).some(node => {
                           return node.classList?.contains('im-file-nav__operate') ||
                                  node.querySelector?.('.im-file-nav__operate');
                       });
            });

            if (hasRelevantChanges) {
                debouncedCheck();
            }
        });

        // 使用更具体的观察配置
        observer.observe(document.body, { 
            childList: true, 
            subtree: true,
            attributes: false,
            characterData: false
        });

        // 初始检查
        checkAndAddOperationButtons();
        
        // 拦截请求（只需要执行一次）
        interceptNetworkRequests();
    }

    // 获取当前选中的目录
    function getSelectedDirectory() {
        // 同时支持根目录和子目录的选择器
        const selectedDirs = document.querySelectorAll('.im-pan-table__body-row.selected, .im-pan-list__item.selected');
        if (selectedDirs.length !== 1) return null;
        
        const selectedDir = selectedDirs[0];
        const title = selectedDir.querySelector('.im-pan-list__file-name-title-text')?.innerText;
        
        if (!title) return null;
        
        // 在 directories 中查找匹配的记录
        const matchedDir = directories.find(dir => dir.server_filename === title);
        if (!matchedDir) {
            console.error(`未找到目录 "${title}" 的记录`);
            return null;
        }
        
        return {
            element: selectedDir,
            title: title,
            dirInfo: matchedDir
        };
    }

    // 检查目录信息并显示相关信息
    function checkDirectoryInfo(msgId, title) {
        console.log(`检查目录: ${title}, msgId: ${msgId}`);

        const matchedDir = directories.find(dir => dir.msg_id === msgId);
        console.log("当前目录数据：", directories);

        if (matchedDir) {
            alert(`匹配到目录: ${title}\nfs_id: ${matchedDir.fs_id}\ngroup_id: ${matchedDir.group_id}\nuk: ${matchedDir.uk}`);
            console.log("匹配的目录信息：", matchedDir);
        } else {
            alert(`未找到与目录 "${title}" 匹配的记录。`);
        }
    }

    // 点击文件库按钮时触发
    function onLibraryButtonClick() {
        console.log("文件库按钮已点击"); // 调试输出
    }

    // 拦截 XMLHttpRequest 请求
    function interceptNetworkRequests() {
        const originalOpen = XMLHttpRequest.prototype.open; // 保存原始 XMLHttpRequest.open

        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            if (url.includes('mbox/group/listshare')) {
                console.log("准备拦截 XMLHttpRequest 请求：", url);
                this.addEventListener('load', function () {
                    try {
                        const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
                        console.log("完整的响应数据：", data); // 调试输出完整数据
                        processLibraryData(data); // 处理文件库数据
                    } catch (e) {
                        console.error("解析响应失败：", e);
                    }
                });
            }

            // 拦截进入目录的请求
            if (url.includes('mbox/msg/shareinfo')) {
                console.log("准备拦截进入目录的 XMLHttpRequest 请求：", url);
                this.addEventListener('load', function () {
                    try {
                        const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
                        console.log("完整的响应数据：", data); // 调试输出完整数据
                        processDirectoryData(data); // 处理目录数据
                    } catch (e) {
                        console.error("解析响应失败：", e);
                    }
                });
            }

            return originalOpen.apply(this, [method, url, ...rest]);
        };
    }

    // 处理文件库数据：取需要的信息并存储
    function processLibraryData(data) {
        if (!data || data.errno !== 0) {
            console.error("获取文件库数据失败或数据为空：", data);
            return;
        }

        const msgList = data.records?.msg_list || []; // 获取 msg_list
        console.log(`发现 ${msgList.length} 条消息。`);

        directories = []; // 清空旧数据

        msgList.forEach((msg, index) => {
            console.log(`正在处理第 ${index + 1} 条消息:`, msg); // 调试输出
            const group_id = msg.group_id; // 获取 group_id
            const uk = msg.uk; // 获取 uk，假设在 msg 中存在

            msg.file_list.forEach(file => {
                console.log(`检查文件: ${file.server_filename}, isdir=${file.isdir}`); // 调试输出
                // 确保 isdir 为数字 1
                if (parseInt(file.isdir) === 1) { // 只处理目录
                    console.log(`添加目录: ${file.server_filename}`); // 打印添加的目录
                    directories.push({
                        fs_id: file.fs_id,
                        server_filename: file.server_filename,
                        group_id: group_id,
                        msg_id: msg.msg_id,
                        uk: uk // 保存 uk
                    });
                }
            });
        });

        console.log("解析后的目录数据：", directories); // 打印目录数据
    }

    // 处理目录数据：提取需要的信息并存储
    function processDirectoryData(data) {
        if (!data || data.errno !== 0) {
            console.error("获取目录数据失败或数据为空：", data);
            return;
        }

        const records = data.records || [];
        console.log(`发现 ${records.length} 条记录。`);

        records.forEach(record => {
            // 保存所有目录信息，包括子目录
            if (parseInt(record.isdir) === 1) {
                console.log(`处理目录: ${record.server_filename}, 原始路径: ${record.path}`);
                
                // 处理路径，移除"我的资源"前缀
                let processedPath = record.path;
                if (processedPath.startsWith('/我的资源/')) {
                    processedPath = processedPath.substring('/我的资源'.length);
                }
                console.log(`处理后的路径: ${processedPath}`);
                
                // 从处理后的路径中提取各级目录
                const pathParts = processedPath.split('/').filter(p => p);
                const rootName = pathParts[0];
                
                console.log(`提取的根目录名: ${rootName}`);
                
                // 查找根目录信息
                const rootDir = directories.find(d => d.server_filename === rootName);
                
                if (rootDir) {
                    // 检查是否已存在相同的记录
                    const existingRecord = directories.find(d => d.fs_id === record.fs_id);
                    if (!existingRecord) {
                        // 构建完整的目录信息
                        const dirInfo = {
                            fs_id: record.fs_id,
                            server_filename: record.server_filename,
                            path: processedPath,
                            group_id: rootDir.group_id,
                            msg_id: rootDir.msg_id,
                            uk: rootDir.uk,
                            parent_path: pathParts.slice(0, -1).join('/'),
                            level: pathParts.length - 1  // 添加层级信息
                        };

                        // 添加到目录列表
                        directories.push(dirInfo);
                        console.log(`添加目录: ${dirInfo.server_filename}, 层级: ${dirInfo.level}, 父路径: ${dirInfo.parent_path}`);
                    }
                } else {
                    console.log(`未找到根目录 "${rootName}" 的信息，可能是新的根目录`);
                    // 如果是根目录级别的分享，直接添加
                    if (pathParts.length === 1) {
                        const dirInfo = {
                            fs_id: record.fs_id,
                            server_filename: record.server_filename,
                            path: processedPath,
                            group_id: record.group_id,
                            msg_id: record.msg_id,
                            uk: record.uk,
                            level: 0
                        };
                        directories.push(dirInfo);
                        console.log(`添加根目录: ${dirInfo.server_filename}`);
                    }
                }
            }
        });

        // 按层级排序，方便调试查看
        directories.sort((a, b) => (a.level || 0) - (b.level || 0));
        console.log("更新后的目录数据：", directories);
    }

    // 修改获取子目录信息的函数
    async function fetchSubdirectories(uk, msgId, fsId, gid, title, depth) {
        console.log(`开始获取子目录信息: ${title}, 深度: ${depth}`);
        
        const startTime = performance.now(); // 添加开始时间记录
        const progressBar = createProgressBar();
        progressBar.show();

        const result = {
            name: title,
            children: [],
            level: 0,
            isRoot: true,
            startTime: startTime // 保存开始时间到结果对象
        };

        let totalDirectories = 0;
        let processedDirectories = 0;

        async function fetchDirContent(parentDir, currentDepth) {
            if (currentDepth >= depth) return;

            let page = 1;
            let hasMore = true;
            const allRecords = [];

            while (hasMore) {
                progressBar.updateText(`正在获取 "${parentDir.name}" 的第 ${page} 页数据...`);
                console.log(`[${parentDir.name}] 正在获取第 ${page} 页数据...`);

                const url = `https://pan.baidu.com/mbox/msg/shareinfo?from_uk=${encodeURIComponent(uk)}&msg_id=${encodeURIComponent(msgId)}&type=2&num=100&page=${page}&fs_id=${encodeURIComponent(parentDir.fs_id || fsId)}&gid=${encodeURIComponent(gid)}&limit=100&desc=1&clienttype=0&app_id=250528&web=1`;

                try {
                    const response = await fetch(url, { timeout: 10000 });
                    const data = await response.json();

                    if (data.errno !== 0) {
                        console.error(`[${parentDir.name}] 获取第 ${page} 页失败:`, data);
                        return;
                    }

                    allRecords.push(...data.records);
                    hasMore = data.has_more === 1;

                    console.log(`[${parentDir.name}] 第 ${page} 页获取成功，本页记录数: ${data.records.length}，hasMore: ${hasMore}`);
                    page++;

                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error(`[${parentDir.name}] 获取第 ${page} 页时发生错误:`, error);
                    return;
                }
            }

            const directories = allRecords.filter(record => parseInt(record.isdir) === 1);
            totalDirectories += directories.length;
            
            console.log(`[${parentDir.name}] 目录获取完成，总页数: ${page - 1}，总记录数: ${allRecords.length}，目录数: ${directories.length}`);

            const promises = directories.map(async record => {
                const childDir = {
                    name: record.server_filename,
                    fs_id: record.fs_id,
                    children: [],
                    level: currentDepth + 1,
                    parentLevel: currentDepth
                };
                parentDir.children.push(childDir);

                if (currentDepth + 1 < depth) {
                    await fetchDirContent(childDir, currentDepth + 1);
                }
                
                processedDirectories++;
                progressBar.updateProgress(processedDirectories, totalDirectories);
            });

            await Promise.all(promises);
        }

        try {
            await fetchDirContent(result, 0);
            progressBar.updateText('目录获取完成！');
            setTimeout(() => progressBar.hide(), 2000);
            return {
                tree: formatDirectoryTree(result), // result 对象中包含了 startTime
                startTime: startTime
            };
        } catch (error) {
            progressBar.updateText('获取目录时发生错误！');
            setTimeout(() => progressBar.hide(), 2000);
            throw error;
        }
    }

    // 添加清理文件名的函数
    function cleanFileName(name) {
        // 移除零宽空格和其他不可见字符
        return name.replace(/[\u200b\u200c\u200d\u200e\u200f\ufeff]/g, '');
    }

    // 修改 formatAllContent 函数中的 formatItem 函数
    function formatItem(node, prefix = '', isLastArray = []) {
        if (node.isRoot) {
            result += `${cleanFileName(node.name)}/\n`;
            if (node.children && node.children.length > 0) {
                node.children.forEach((child, index) => {
                    const isLast = index === node.children.length - 1;
                    formatItem(child, '', [isLast]);
                });
            }
        } else {
            const connector = isLastArray[isLastArray.length - 1] ? SYMBOLS.last : SYMBOLS.tee;
            const cleanName = cleanFileName(node.name);
            const itemName = node.isDir ? `${cleanName}/` : cleanName;
            const size = !node.isDir ? ` (${formatSize(node.size)})` : '';
            
            result += `${prefix}${connector}${itemName}${size}\n`;

            if (node.children && node.children.length > 0) {
                node.children.forEach((child, index) => {
                    const isLast = index === node.children.length - 1;
                    const newPrefix = prefix + (isLastArray[isLastArray.length - 1] ? SYMBOLS.space : SYMBOLS.branch);
                    formatItem(child, newPrefix, [...isLastArray, isLast]);
                });
            }
        }
    }

    // 修改格式化函数
    function formatDirectoryTree(dir) {
        const formatStartTime = performance.now(); // 添加格式化开始时间
        const SYMBOLS = {
            space:  '    ',
            branch: '│   ',
            tee:    '├──',
            last:   '└──'
        };
        
        let result = '';
        const currentTime = new Date().toLocaleString();
        
        // 添加标题和信息头
        result += `目录结构导出清单\n`;
        result += `导出时间：${currentTime}\n`;
        result += `根目录：${dir.name}\n`;
        result += `${'='.repeat(50)}\n\n`;

        // 内部函数，用于格式化目录
        function formatDir(node, prefix = '', isLastArray = []) {
            if (node.isRoot) {
                result += `${cleanFileName(node.name)}\n`;
                if (node.children && node.children.length > 0) {
                    node.children.forEach((child, index) => {
                        const isLast = index === node.children.length - 1;
                        formatDir(child, '', [isLast]);
                    });
                }
            } else {
                const connector = isLastArray[isLastArray.length - 1] ? SYMBOLS.last : SYMBOLS.tee;
                result += `${prefix}${connector}${cleanFileName(node.name)}\n`;

                if (node.children && node.children.length > 0) {
                    node.children.forEach((child, index) => {
                        const isLast = index === node.children.length - 1;
                        const newPrefix = prefix + (isLastArray[isLastArray.length - 1] ? SYMBOLS.space : SYMBOLS.branch);
                        formatDir(child, newPrefix, [...isLastArray, isLast]);
                    });
                }
            }
        }

        // 调用格式化函数
        formatDir(dir, '', []);
        
        const endTime = performance.now(); // 记录结束时间
        const formatTime = ((endTime - formatStartTime) / 1000).toFixed(2); // 格式化耗时
        const totalTime = ((endTime - (dir.startTime || formatStartTime)) / 1000).toFixed(2); // 总耗时
        
        // 添加页脚和统计信息
        result += `\n${'='.repeat(50)}\n`;
        result += `统计信息：\n`;
        result += `目录数量：${countDirectories(dir)} 个\n`;
        result += `格式化耗时：${formatTime} 秒\n`;
        if (dir.startTime) { // 如果有开始时间才显示总耗时
            result += `总处理耗时：${totalTime} 秒\n`;
        }
        
        return result;
    }

    // 添加统计目录数量的辅助函数
    function countDirectories(dir) {
        let count = 0;
        
        function traverse(node) {
            if (node.children && node.children.length > 0) {
                count += node.children.length;
                node.children.forEach(traverse);
            }
        }
        
        traverse(dir);
        return count;
    }

    // 保存为 TXT 文件
    function saveAsTxt(content, title) {
        const blob = new Blob([content], { type: 'text/plain' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${title}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log(`已保存文件: ${title}.txt`); // 调试输出
    }

    // 添加获取全部内容的函数
    async function fetchAllContent(uk, msgId, fsId, gid, title, depth) {
        const startTime = performance.now(); // 记录总处理开始时间
        console.log(`开始获取所有内容: ${title}, 深度: ${depth}`);
        
        const progressBar = createProgressBar();
        progressBar.show();

        const result = {
            name: title,
            children: [],
            level: 0,
            isRoot: true,
            startTime: startTime // 保存开始时间
        };

        let totalItems = 0;
        let processedItems = 0;

        async function fetchContent(parentDir, currentDepth) {
            if (currentDepth >= depth) return;

            let page = 1;
            let hasMore = true;
            const allRecords = [];
            const maxRetries = 3; // 最大重试次数
            const requestPool = new RequestPool(2, 3000); // 降低并发数，增加间隔

            while (hasMore) {
                progressBar.updateText(`正在获取 "${parentDir.name}" 的第 ${page} 页数据...`);
                console.log(`[${parentDir.name}] 正在获取第 ${page} 页数据...`);

                const url = `https://pan.baidu.com/mbox/msg/shareinfo?from_uk=${encodeURIComponent(uk)}&msg_id=${encodeURIComponent(msgId)}&type=2&num=100&page=${page}&fs_id=${encodeURIComponent(parentDir.fs_id || fsId)}&gid=${encodeURIComponent(gid)}&limit=100&desc=1&clienttype=0&app_id=250528&web=1`;

                let retryCount = 0;
                let success = false;

                while (retryCount < maxRetries && !success) {
                    try {
                        const data = await requestPool.add(async () => {
                            const response = await fetch(url, { 
                                timeout: 30000,  // 增加超时时间到30秒
                                headers: {
                                    'Cache-Control': 'no-cache',
                                    'Pragma': 'no-cache'
                                }
                            });
                            if (!response.ok) {
                                throw new Error(`HTTP error! status: ${response.status}`);
                            }
                            return response.json();
                        });

                        if (data.errno !== 0) {
                            throw new Error(`API error: ${data.errno}`);
                        }

                        allRecords.push(...data.records);
                        hasMore = data.has_more === 1;
                        success = true;

                        console.log(`[${parentDir.name}] 第 ${page} 页获取成功，本页记录数: ${data.records.length}，hasMore: ${hasMore}`);
                    } catch (error) {
                        retryCount++;
                        console.error(`[${parentDir.name}] 获取第 ${page} 页失败 (尝试 ${retryCount}/${maxRetries}):`, error);
                        
                        if (retryCount < maxRetries) {
                            const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // 指数退避策略
                            progressBar.updateText(`请求失败，${delay/1000}秒后重试...`);
                            await new Promise(resolve => setTimeout(resolve, delay));
                        } else {
                            progressBar.updateText(`获取 "${parentDir.name}" 第 ${page} 页失败，跳过...`);
                            console.error(`[${parentDir.name}] 达到最大重试次数，跳过此页`);
                            hasMore = false; // 停止获取更多页面
                        }
                    }
                }

                if (success) {
                    page++;
                    // 成功后也适当延迟，避免请求过快
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            // 处理所有记录（包括文件和目录）
            totalItems += allRecords.length;
            
            const promises = allRecords.map(async record => {
                const childItem = {
                    name: record.server_filename,
                    fs_id: record.fs_id,
                    isDir: parseInt(record.isdir) === 1,
                    size: record.size,
                    children: [],
                    level: currentDepth + 1,
                    parentLevel: currentDepth
                };
                parentDir.children.push(childItem);

                if (childItem.isDir && currentDepth + 1 < depth) {
                    await fetchContent(childItem, currentDepth + 1);
                }
                
                processedItems++;
                progressBar.updateProgress(processedItems, totalItems);
            });

            await Promise.all(promises);
        }

        try {
            await fetchContent(result, 0);
            progressBar.updateText('内容获取完成！');
            setTimeout(() => progressBar.hide(), 2000);
            return {
                tree: formatAllContent(result),
                startTime: startTime // 传递开始时间
            };
        } catch (error) {
            progressBar.updateText('获取内容时发生错误！');
            setTimeout(() => progressBar.hide(), 2000);
            throw error;
        }
    }

    // 添加格式化全部内容的函数
    function formatAllContent(dir) {
        const formatStartTime = performance.now(); // 格式化开始时间
        let result = '';
        const currentTime = new Date().toLocaleString();
        
        const SYMBOLS = {
            space:  '    ',
            branch: '│   ',
            tee:    '├──',
            last:   '└──'
        };
        
        result += `完整目录结构导出清单\n`;
        result += `导出时间：${currentTime}\n`;
        result += `根目录：${dir.name}\n`;
        result += `${'='.repeat(50)}\n\n`;

        let fileCount = 0;
        let dirCount = 0;
        let totalSize = 0;

        function formatItem(node, prefix = '', isLastArray = []) {
            if (node.isRoot) {
                result += `${cleanFileName(node.name)}/\n`;
                if (node.children && node.children.length > 0) {
                    node.children.forEach((child, index) => {
                        const isLast = index === node.children.length - 1;
                        formatItem(child, '', [isLast]);
                    });
                }
            } else {
                const connector = isLastArray[isLastArray.length - 1] ? SYMBOLS.last : SYMBOLS.tee;
                const cleanName = cleanFileName(node.name);
                const itemName = node.isDir ? `${cleanName}/` : cleanName;
                const size = !node.isDir ? ` (${formatSize(node.size)})` : '';
                
                result += `${prefix}${connector}${itemName}${size}\n`;

                if (node.isDir) {
                    dirCount++;
                } else {
                    fileCount++;
                    totalSize += node.size || 0;
                }

                if (node.children && node.children.length > 0) {
                    node.children.forEach((child, index) => {
                        const isLast = index === node.children.length - 1;
                        const newPrefix = prefix + (isLastArray[isLastArray.length - 1] ? SYMBOLS.space : SYMBOLS.branch);
                        formatItem(child, newPrefix, [...isLastArray, isLast]);
                    });
                }
            }
        }

        formatItem(dir, '', []);
        
        const endTime = performance.now(); // 记录结束时间
        const formatTime = ((endTime - formatStartTime) / 1000).toFixed(2); // 格式化耗时
        const totalTime = ((endTime - dir.startTime) / 1000).toFixed(2); // 总耗时
        
        result += `\n${'='.repeat(50)}\n`;
        result += `统计信息：\n`;
        result += `目录数量：${dirCount}\n`;
        result += `文件数量：${fileCount}\n`;
        result += `文件大小：${formatSize(totalSize)}\n`;
        result += `处理总计：${dirCount + fileCount} 个项目\n`;
        result += `格式化耗时：${formatTime} 秒\n`;
        result += `总处理耗时：${totalTime} 秒\n`;
        
        return result;
    }

    // 添加文件大小格式化函数
    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 启动 MutationObserver，等待文件库按钮和标题加载
    waitForLibraryElements();
})();

