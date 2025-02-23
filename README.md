# NBNT: 新版百度网盘共享文件库目录导出工具

## 简介

这是一个用于导出百度网盘共享文件库目录和文件列表的油猴脚本。基于 [Avens666/BaidunNetDisk-script](https://github.com/Avens666/BaidunNetDisk-script) 项目。因为原项目不支持新版百度网盘，所以在原项目基础上进行了重构。感谢[Cursor](https://www.cursor.com/)让我这个非码农能轻松的完成这个项目。

## 功能

- 支持导出目录结构
- 支持导出完整文件列表（包含文件大小）
- 支持自定义导出层级深度
- 提供进度显示
- 支持大文件夹分页获取
- 支持树形和制表符两种格式导出
- 支持导出为 Excel 格式

## TODO

- ~~支持更多导出格式~~

## 更新日志

- 2025-02-22 增加Tab缩进的目录分级样式，增加目录大小显示
            ![06](https://raw.githubusercontent.com/ujincn/NBNT/v2/imgs/06.webp)
- 2025-01-26 增加导出为Excel功能
- 2024-12-09 功能测试完成，发布到Github

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或其他油猴脚本管理器。
2. 点击[这里](https://raw.githubusercontent.com/ujincn/NBNT/v2/NBNT.user.js)或者[这里](https://update.greasyfork.org/scripts/520280/NBNT%3A%20%E6%96%B0%E7%89%88%E7%99%BE%E5%BA%A6%E7%BD%91%E7%9B%98%E5%85%B1%E4%BA%AB%E6%96%87%E4%BB%B6%E5%BA%93%E7%9B%AE%E5%BD%95%E5%AF%BC%E5%87%BA%E5%B7%A5%E5%85%B7.user.js)安装脚本。
3. 如果上一步没有成功，则将文件下载到本地进行手动安装。
4. 打开脚本管理器，选择“添加新脚本”。
5. 将 `NBNT.user.js` 文件中的代码复制粘贴到新建脚本中。
6. 保存并启用脚本。

## 使用方法

1. 打开百度网盘网页版  
![img01](https://raw.githubusercontent.com/ujincn/NBNT/v2/imgs/01.png)  

2. 进入共享文件库页面
![img02](https://raw.githubusercontent.com/ujincn/NBNT/v2/imgs/02.png)  ![img03](https://raw.githubusercontent.com/ujincn/NBNT/v2/imgs/03.png)

3. 选择要导出的目录  
![img04](https://raw.githubusercontent.com/ujincn/NBNT/v2/imgs/04.png)

4. 点击工具栏中的按钮  
- a. 【检查目录】：查看选中目录基本信息
- b. 【导出目录】：仅导出选中目录及子目录结构
- c. 【导出全部】：导出选中目录及子目录和文件列表
- d. 【配置面板】：打开配置面板，可以设置导出格式和其他参数
![img05](https://raw.githubusercontent.com/ujincn/NBNT/v2/imgs/05.png)

5. 配置面板说明
- 功能设置：可以选择目录分级样式（树形或制表符）和是否显示目录大小  
![config01](https://raw.githubusercontent.com/ujincn/NBNT/v2/imgs/config01.png)  
- 参数设置：可以调整并发请求数、请求间隔等技术参数  
![config02](https://raw.githubusercontent.com/ujincn/NBNT/v2/imgs/config02.png)

## 注意事项

- 请确保网络连接正常，以便脚本能够正确获取目录信息。
- 文件数量过多或导出层数过多可能导致请求时间较长，请耐心等待。


## 导出示例

### 目录结构导出清单示例
<details>

```
目录结构导出清单示例
导出时间：2024/3/14 15:30:25
根目录：【教程资源】
==================================================

【教程资源】
├── 编程开发
│   ├── Python基础教程
│   ├── Web前端开发
│   │   ├── HTML+CSS教程
│   │   ├── JavaScript进阶
│   │   └── Vue.js实战
│   └── 数据库教程
├── 设计资源
│   ├── PS教程
│   └── UI设计
└── 办公软件
    ├── Excel教程
    └── PPT模板

==================================================
统计信息：
目录数量：10 个
格式化耗时：0.00 秒
总处理耗时：5.40 秒
```
</details>

### 完整目录结构导出清单示例
<details>

```
完整目录结构导出清单示例
导出时间：2024/3/14 15:31:10
根目录：【教程资源】
==================================================

【教程资源】/
├── 编程开发/
│   ├── Python基础教程/
│   │   ├── 第1章 Python入门.pdf (15.2 MB)
│   │   ├── 第2章 数据类型.pdf (12.8 MB)
│   │   └── 课程源代码.zip (2.5 MB)
│   ├── Web前端开发/
│   │   ├── HTML+CSS教程/
│   │   │   ├── 基础教程.pdf (8.6 MB)
│   │   │   └── 示例代码.zip (1.2 MB)
│   │   └── JavaScript进阶/
│   │       ├── ES6新特性.pdf (5.8 MB)
│   │       └── 实例代码.zip (890 KB)
│   └── 数据库教程/
│       ├── MySQL基础.pdf (18.3 MB)
│       └── 练习题.doc (2.1 MB)
└── 设计资源/
    ├── PS教程/
    │   ├── PS基础操作.mp4 (156.8 MB)
    │   └── 素材.zip (85.2 MB)
    └── UI设计/
        ├── 设计规范.pdf (12.5 MB)
        └── 案例源文件.psd (245.6 MB)

==================================================
统计信息：
目录数量：8
文件数量：12
文件大小：567.5 MB
处理总计：20 个项目
格式化耗时：0.15 秒
总处理耗时：25.32 秒
```
</details>


## 贡献

欢迎提交问题和功能请求，您也可以通过提交 PR 来贡献代码。

## 许可证

此项目采用 MIT 许可证。
