// ==UserScript==
// @name         NBNT: 新版百度网盘共享文件库目录导出工具
// @namespace    http://tampermonkey.net/
// @version      0.268
// @description  用于导出百度网盘共享文件库目录和文件列表
// @author       UJiN
// @license      MIT
// @match        https://pan.baidu.com/disk*
// @icon         https://nd-static.bdstatic.com/m-static/v20-main/favicon-main.ico
// @grant        GM_xmlhttpRequest
// @require      https://unpkg.com/xlsx/dist/xlsx.full.min.js
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
            width: 350px;
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
            remove: () => {
                if (progressContainer.parentNode) {
                    progressContainer.parentNode.removeChild(progressContainer);
                }
            },
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
                const operateDiv = document.querySelector('.im-file-nav__operate');
                const downloadButton = operateDiv?.querySelector('.u-icon-download')?.closest('button');
                
                if (!operateDiv || !downloadButton) {
                    isProcessing = false;
                    return;
                }

                const existingCheckButton = document.querySelector('#check-dir-button');
                const existingFetchButton = document.querySelector('#fetch-dir-button');
                
                if (existingCheckButton || existingFetchButton) {
                    isProcessing = false;
                    return;
                }

                // 添加样式
                const style = document.createElement('style');
                style.textContent = `
                    .export-dropdown {
                        position: relative;
                        display: inline-flex;
                        align-items: center;
                        cursor: pointer;
                        height: 24px;
                        line-height: 24px;
                    }
                    .export-dropdown::after {
                        content: '';
                        position: absolute;
                        right: -12px;
                        top: 6px;
                        width: 1px;
                        height: 12px;
                        background-color: rgb(217, 217, 217);
                    }
                    .export-dropdown-menu {
                        display: none;
                        position: absolute;
                        top: 100%;
                        left: 50%;
                        transform: translateX(-50%);
                        background: white;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                        padding: 4px;
                        z-index: 99999;
                        margin-top: 2px;
                        border: 1px solid #e8e8e8;
                        white-space: nowrap;
                        flex-direction: row;
                    }
                    .export-dropdown-menu.show {
                        display: flex;
                    }
                    .export-item {
                        padding: 4px 12px;
                        cursor: pointer;
                        color: #333;
                        font-size: 12px;
                        line-height: 1.5;
                        border-right: 1px solid #e8e8e8;
                    }
                    .export-item:last-child {
                        border-right: none;
                    }
                    .export-item:hover {
                        background: #f5f5f5;
                    }
                `;
                document.head.appendChild(style);

                const checkButton = document.createElement('button');
                checkButton.id = 'check-dir-button';
                checkButton.type = 'button';
                checkButton.className = 'u-button u-button--default u-button--mini';
                checkButton.innerHTML = `
                    <i class="u-icon-search"></i>
                    <span>检查目录</span>
                `;
                
                const exportDropdown = document.createElement('div');
                exportDropdown.className = 'export-dropdown u-button u-button--default u-button--mini';
                exportDropdown.innerHTML = `
                    <i class="u-icon-folder"></i>
                    <span>导出目录</span>
                    <i class="u-icon-arrow-down" style="margin-left: 4px;"></i>
                    <div class="export-dropdown-menu">
                        <div class="export-item" data-type="txt">导出为TXT</div>
                        <div class="export-item" data-type="xlsx">导出为Excel</div>
                    </div>
                `;

                const fetchAllDropdown = document.createElement('div');
                fetchAllDropdown.className = 'export-dropdown u-button u-button--default u-button--mini';
                fetchAllDropdown.innerHTML = `
                    <i class="u-icon-download-bold"></i>
                    <span>导出全部</span>
                    <i class="u-icon-arrow-down" style="margin-left: 4px;"></i>
                    <div class="export-dropdown-menu">
                        <div class="export-item" data-type="txt">导出为TXT</div>
                        <div class="export-item" data-type="xlsx">导出为Excel</div>
                    </div>
                `;

                checkButton.onclick = function() {
                    const selected = getSelectedDirectory();
                    if (!selected) {
                        alert('请选中一个目录!');
                        return;
                    }
                    const { dirInfo, title } = selected;
                    checkDirectoryInfo(dirInfo.msg_id, title);
                };

                // 处理导出选项点击
                exportDropdown.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const menu = this.querySelector('.export-dropdown-menu');
                    menu.classList.toggle('show');
                });

                // 点击其他地方关闭菜单
                document.addEventListener('click', function() {
                    const menus = document.querySelectorAll('.export-dropdown-menu');
                    menus.forEach(menu => menu.classList.remove('show'));
                });

                // 防止菜单项点击事件冒泡
                exportDropdown.querySelector('.export-dropdown-menu').addEventListener('click', function(e) {
                    e.stopPropagation();
                });

                exportDropdown.querySelector('.export-dropdown-menu').addEventListener('click', async function(e) {
                    const exportType = e.target.dataset.type;
                    if (!exportType) return;

                    try {
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
                        if (!window.cancelOperation && result) {
                            if (exportType === 'txt') {
                                const formattedContent = formatDirectoryTree(result.tree);
                                saveAsTxt(formattedContent, title);
                            } else if (exportType === 'xlsx') {
                                saveAsExcel(result, title);
                            }
                        }
                    } finally {
                        cleanup();
                    }
                });

                // 处理导出全部按钮的点击事件
                fetchAllDropdown.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const menu = this.querySelector('.export-dropdown-menu');
                    menu.classList.toggle('show');
                });

                // 防止菜单项点击事件冒泡
                fetchAllDropdown.querySelector('.export-dropdown-menu').addEventListener('click', function(e) {
                    e.stopPropagation();
                });

                // 修改导出全部选项的点击处理
                fetchAllDropdown.querySelector('.export-dropdown-menu').addEventListener('click', async function(e) {
                    const exportType = e.target.dataset.type;
                    if (!exportType) return;

                    try {
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
                        if (!window.cancelOperation && result) {
                            if (exportType === 'txt') {
                                // TXT 导出时进行格式化
                                const formattedContent = formatAllContent(result.tree);
                                saveAsTxt(formattedContent, title + "_完整");
                            } else if (exportType === 'xlsx') {
                                // Excel 导出使用原始数据结构
                                saveAsExcel(result, title + "_完整");
                            }
                        }
                    } finally {
                        cleanup();
                    }
                });

                // 修改按钮插入顺序
                requestAnimationFrame(() => {
                    downloadButton.after(fetchAllDropdown);
                    downloadButton.after(document.createTextNode(' ')); // 添加空格
                    downloadButton.after(exportDropdown);
                    downloadButton.after(document.createTextNode(' ')); // 添加空格
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

    // 拦截 XMLHttpRequest 请求
    function interceptNetworkRequests() {
        const originalOpen = XMLHttpRequest.prototype.open; // 保存原始 XMLHttpRequest.open

        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            if (url.includes('mbox/group/listshare')) {
                console.log("准备拦截 XMLHttpRequest 请求：", url);
                this.addEventListener('load', function () {
                    try {
                        const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
                        console.debug("完整的响应数据：", data); // 调试输出完整数据
                        processLibraryData(data);
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
                        console.debug("完整的响应数据：", data); // 调试输出完整数据
                        processDirectoryData(data); 
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
            console.error("文件库数据获取失败，错误码：", data?.errno);
            return;
        }

        // 在获取新的文件库数据时才清空旧数据
        directories = []; 
        
        const msgList = data.records?.msg_list || [];

        msgList.forEach((msg, index) => {
            const group_id = msg.group_id;
            const uk = msg.uk;

            msg.file_list.forEach(file => {
                if (parseInt(file.isdir) === 1) {
                    directories.push({
                        fs_id: file.fs_id,
                        server_filename: file.server_filename,
                        group_id: group_id,
                        msg_id: msg.msg_id,
                        uk: uk
                    });
                }
            });
        });
    }

    // 处理目录数据：提取需要的信息并存储
    function processDirectoryData(data) {
        if (!data || data.errno !== 0) {
            console.error("目录数据获取失败，错误码：", data?.errno);
            return;
        }

        const records = data.records || [];

        records.forEach(record => {
            // 保存所有目录信息，包括子目录
            if (parseInt(record.isdir) === 1) {
                // 处理路径，移除"我的资源"前缀
                let processedPath = record.path;
                if (processedPath.startsWith('/我的资源/')) {
                    processedPath = processedPath.substring('/我的资源'.length);
                }
                
                // 从处理后的路径中提取各级目录
                const pathParts = processedPath.split('/').filter(p => p);
                const rootName = pathParts[0];
                
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
                    }
                } else {
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
                    }
                }
            }
        });

        // 按层级排序，方便调试查看
        directories.sort((a, b) => (a.level || 0) - (b.level || 0));
    }

    // 获取子目录信息
    async function fetchSubdirectories(uk, msgId, fsId, gid, title, depth) {
        console.log(`开始获取子目录信息: ${title}, 深度: ${depth}`);
        
        const startTime = performance.now();
        const progressBar = createProgressBar();
        progressBar.show();

        let result = {
            name: title,
            children: [],
            level: 0,
            isRoot: true,
            startTime: startTime
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
                    parentLevel: currentDepth,
                    isDir: true
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
                tree: result,
                startTime: startTime
            };
        } finally {
            progressBar.remove();
            result = null;
            cleanup();
        }
    }

    // 添加清理文件名的函数
    function cleanFileName(name) {
        // 移除零宽空格和其他不可见字符
        return name.replace(/[\u200b\u200c\u200d\u200e\u200f\ufeff]/g, '');
    }

    // 格式化目录树
    function formatDirItem(node, prefix = '', isLastArray = []) {
        if (node.isRoot) {
            result += `${cleanFileName(node.name)}/\n`;
            if (node.children && node.children.length > 0) {
                node.children.forEach((child, index) => {
                    const isLast = index === node.children.length - 1;
                    formatDirItem(child, '', [isLast]);
                });
            }
        } else {
            const connector = isLastArray[isLastArray.length - 1] ? SYMBOLS.last : SYMBOLS.tee;
            const cleanName = cleanFileName(node.name);
            result += `${prefix}${connector}${cleanName}\n`;

            if (node.children && node.children.length > 0) {
                node.children.forEach((child, index) => {
                    const isLast = index === node.children.length - 1;
                    const newPrefix = prefix + (isLastArray[isLastArray.length - 1] ? SYMBOLS.space : SYMBOLS.branch);
                    formatDirItem(child, newPrefix, [...isLastArray, isLast]);
                });
            }
        }
    }

    function formatDirectoryTree(dir) {
        const formatStartTime = performance.now();
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

        formatDir(dir, '', []);
        
        const endTime = performance.now();
        const formatTime = ((endTime - formatStartTime) / 1000).toFixed(2); // 格式化耗时
        const totalTime = ((endTime - (dir.startTime || formatStartTime)) / 1000).toFixed(2); // 总耗时
        
        // 添加页脚和统计信息
        result += `\n${'='.repeat(50)}\n`;
        result += `统计信息：\n`;
        result += `目录数量：${countDirectories(dir)} 个\n`;
        result += `格式化耗时：${formatTime} 秒\n`;
        if (dir.startTime) {
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
        console.log(`已保存文件: ${title}.txt`);
    }

    // 添加获取全部内容的函数
    async function fetchAllContent(uk, msgId, fsId, gid, title, depth) {
        const startTime = performance.now();
        const progressBar = createProgressBar();
        progressBar.show();

        let result = {
            name: title,
            children: [],
            level: 0,
            isRoot: true,
            startTime: startTime
        };

        let totalItems = 0;
        let processedItems = 0;

        async function fetchContent(parentDir, currentDepth) {
            if (currentDepth >= depth) return;

            let page = 1;
            let hasMore = true;
            const allRecords = [];
            const maxRetries = 3;
            const requestPool = new RequestPool(2, 3000);

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
                                timeout: 30000,
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
                        console.error(`[${parentDir.name}] 页面 ${page} 获取失败 (${retryCount}/${maxRetries})`);
                        
                        if (retryCount < maxRetries) {
                            const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // 指数退避策略
                            progressBar.updateText(`请求失败，${delay/1000}秒后重试...`);
                            await new Promise(resolve => setTimeout(resolve, delay));
                        } else {
                            progressBar.updateText(`获取 "${parentDir.name}" 第 ${page} 页失败，跳过...`);
                            console.error(`[${parentDir.name}] 达到重试上限，跳过`);
                            hasMore = false; 
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
                tree: result,
                startTime: startTime
            };
        } finally {
            progressBar.remove();
            result = null;
            cleanup();
        }
    }

    function formatAllContent(dir) {
        const formatStartTime = performance.now();
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
        
        const endTime = performance.now();
        const formatTime = ((endTime - formatStartTime) / 1000).toFixed(2);
        const totalTime = ((endTime - dir.startTime) / 1000).toFixed(2);
        
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

    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function cleanup() {
        const progressBar = document.getElementById('directory-progress');
        if (progressBar && progressBar.parentNode) {
            progressBar.parentNode.removeChild(progressBar);
        }
    }

    function saveAsExcel(data, title) {
        const wb = XLSX.utils.book_new();
        
        const excelData = [];
        
        excelData.push(['目录结构导出清单']);
        excelData.push([`导出时间: ${new Date().toLocaleString()}`]);
        
        let fileCount = 0;
        let dirCount = 0;
        let totalSize = 0;
        
        function countItems(node) {
            if (!node.isRoot) {
                if (node.isDir) {
                    dirCount++;
                } else {
                    fileCount++;
                    totalSize += node.size || 0;
                }
            }
            if (node.children && node.children.length > 0) {
                node.children.forEach(countItems);
            }
        }
        
        countItems(data.tree);
        
        excelData.push(['统计信息']);
        excelData.push([`目录数量: ${dirCount}`]);
        if (fileCount > 0) {
            excelData.push([`文件数量: ${fileCount}`]);
            excelData.push([`文件大小: ${formatSize(totalSize)}`]);
            excelData.push([`处理总计: ${dirCount + fileCount} 个项目`]);
        }
        excelData.push([`格式化耗时: ${((performance.now() - data.startTime) / 1000).toFixed(2)} 秒`]);
        excelData.push(['']);
        
        function getMaxDepth(node, currentDepth = 0) {
            if (!node.children || node.children.length === 0) {
                return currentDepth;
            }
            return Math.max(...node.children.map(child => 
                getMaxDepth(child, currentDepth + 1)
            ));
        }
        
        const actualDepth = Math.min(depthSetting, getMaxDepth(data.tree) + 1);
        
        const headers = [];
        for (let i = 1; i <= actualDepth; i++) {
            headers.push(`${i}级目录`);
        }
        excelData.push(headers);
        
        const allRows = [];
        
        function extractNumber(str) {
            const match = str.match(/^(\d+)\./);
            return match ? parseInt(match[1]) : Infinity;
        }

        function compareItems(a, b) {
            const numA = extractNumber(a.name);
            const numB = extractNumber(b.name);
            
            if (numA !== numB) {
                return numA - numB;
            }
            
            return a.name.localeCompare(b.name, 'zh-CN');
        }

        function processNode(node, level = 0, parentRow = []) {
            if (level >= actualDepth) return;
            
            const currentRow = [...parentRow];
            
            if (!node.isRoot) {
                currentRow[level] = node.name;
                allRows.push([...currentRow]);
            }
            
            if (node.children && node.children.length > 0) {
                if (node.isRoot) {
                    node.children.sort(compareItems);
                    node.children.forEach(child => {
                        const newRow = new Array(actualDepth).fill('');
                        newRow[0] = child.name;
                        allRows.push([...newRow]);
                        
                        if (child.children && child.children.length > 0) {
                            child.children.sort(compareItems);
                            child.children.forEach(grandChild => {
                                processNode(grandChild, 1, newRow);
                            });
                        }
                    });
                } else {
                    node.children.sort(compareItems);
                    node.children.forEach(child => {
                        processNode(child, level + 1, currentRow);
                    });
                }
            }
        }
        
        processNode(data.tree, 0, new Array(actualDepth).fill(''));
        
        excelData.push(...allRows);
        
        const ws = XLSX.utils.aoa_to_sheet(excelData);
        
        const colWidths = [];
        for (let i = 0; i < actualDepth; i++) {
            colWidths.push({ wch: 45 });
        }
        ws['!cols'] = colWidths;
        
        ws['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: actualDepth - 1 } },  // 标题行
            { s: { r: 1, c: 0 }, e: { r: 1, c: actualDepth - 1 } },  // 时间行
            { s: { r: 2, c: 0 }, e: { r: 2, c: actualDepth - 1 } },  // 统计信息标题
            { s: { r: 3, c: 0 }, e: { r: 3, c: actualDepth - 1 } },  // 目录数量
        ];
        
        if (fileCount > 0) {
            ws['!merges'].push(
                { s: { r: 4, c: 0 }, e: { r: 4, c: actualDepth - 1 } },  // 文件数量
                { s: { r: 5, c: 0 }, e: { r: 5, c: actualDepth - 1 } },  // 文件大小
                { s: { r: 6, c: 0 }, e: { r: 6, c: actualDepth - 1 } },  // 处理总计
                { s: { r: 7, c: 0 }, e: { r: 7, c: actualDepth - 1 } },  // 格式化耗时
                { s: { r: 8, c: 0 }, e: { r: 8, c: actualDepth - 1 } }   // 空行
            );
        } else {
            ws['!merges'].push(
                { s: { r: 4, c: 0 }, e: { r: 4, c: actualDepth - 1 } },  // 格式化耗时
                { s: { r: 5, c: 0 }, e: { r: 5, c: actualDepth - 1 } }   // 空行
            );
        }
        
        XLSX.utils.book_append_sheet(wb, ws, '目录结构');
        
        XLSX.writeFile(wb, `${title}.xlsx`);
    }

    waitForLibraryElements();
})();

