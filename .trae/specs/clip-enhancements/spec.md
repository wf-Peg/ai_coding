# 剪藏功能增强 - Product Requirement Document

## Overview
- **Summary**: 本次功能增强为剪藏系统添加Git操作集成、待办事项时间线、Obsidian兼容标签格式和周报总结功能，提升用户的知识管理和信息组织效率。
- **Purpose**: 解决用户在信息管理过程中缺少版本控制、任务追踪、知识库兼容性和周报自动生成的问题，使剪藏系统成为更全面的个人知识管理工具。
- **Target Users**: 需要频繁收集和整理信息、使用Obsidian进行知识管理、需要任务追踪和周报功能的个人用户。

## Goals
- 提供Git推送和同步功能，方便用户备份和版本控制剪藏数据
- 添加待办事项时间线功能，帮助用户追踪和管理任务
- 优化标签记录格式，支持Obsidian的独立标签展示
- 实现周报总结功能，自动整理最近7天的剪藏内容并支持知识点双链引用

## Non-Goals (Out of Scope)
- 不实现Git仓库创建和配置功能，仅提供Git操作的执行入口
- 不实现复杂的任务依赖关系和甘特图功能
- 不实现Obsidian插件集成，仅生成兼容Obsidian的文件格式
- 不实现团队协作功能，保持个人工具定位

## Background & Context
- 剪藏系统当前是一个基于Spring Boot和React的本地个人信息管理工具，支持信息剪藏、AI分析和每日内容整理
- 系统使用本地文件系统存储数据，需要增加版本控制和云备份支持
- 许多用户使用Obsidian进行知识管理，需要提高兼容性
- 用户需要定期回顾和总结知识，日报功能需要扩展到周报

## Functional Requirements
- **FR-1**: 在应用级和前端添加Git操作按钮，执行git推送和git同步脚本
- **FR-2**: 在页面左侧添加待办事项垂直时间线，支持截止日期和任务内容的填空式填写
- **FR-3**: 整理今日内容的后端优化标签记录格式，支持Obsidian的独立标签展示如`tag:#java`
- **FR-4**: 增加周报总结按钮，总结最近7天内的剪藏内容，支持知识点双链引用和拆分

## Non-Functional Requirements
- **NFR-1**: Git操作需要有状态反馈，操作结果需要在10秒内显示
- **NFR-2**: 待办事项时间线需要响应式布局，支持移动端显示
- **NFR-3**: 周报生成速度不超过30秒（取决于剪藏数量）
- **NFR-4**: 所有新增功能需要与现有功能保持解耦，不影响现有功能的稳定性

## Constraints
- **Technical**: 使用现有的Spring Boot 3.2.0和React技术栈，不引入新的大型依赖
- **Business**: Git功能需要用户自行配置Git权限和仓库
- **Dependencies**: 依赖系统已安装的Git命令行工具

## Assumptions
- 用户已在系统中安装Git并配置好仓库
- 用户了解Git的基本操作概念
- Obsidian兼容文件格式使用标准的Markdown和双链语法
- 周报功能需要AI服务支持，假设AI服务可用

## Acceptance Criteria

### AC-1: Git操作功能
- **Given**: 用户已在系统中配置好Git仓库和权限
- **When**: 用户点击Git推送或Git同步按钮
- **Then**: 系统执行相应的Git命令，显示操作结果和状态
- **Verification**: `programmatic`
- **Notes**: 需要处理Git操作失败的情况，显示清晰的错误信息

### AC-2: 待办事项时间线
- **Given**: 用户在剪藏系统主页面
- **When**: 用户在左侧时间线区域填写截止日期和待办事项并保存
- **Then**: 待办事项按截止日期排序展示，同一天的内容可归档，数据存储到对应剪藏目录的todoList文件夹
- **Verification**: `human-judgment`
- **Notes**: 时间线需要美观的UI设计

### AC-3: Obsidian兼容标签格式
- **Given**: 用户使用整理今日内容功能
- **When**: 系统生成整理后的Markdown文件
- **Then**: 标签以Obsidian兼容的独立格式展示，如`tag:#java`
- **Verification**: `programmatic`
- **Notes**: 需要保持与现有标签功能的兼容性

### AC-4: 周报总结功能
- **Given**: 用户点击周报总结按钮
- **When**: 系统处理最近7天的剪藏内容
- **Then**: 生成一份周报总结文档和拆分的知识点文档，存储到weeklyReport目录，支持Obsidian双链引用
- **Verification**: `programmatic`
- **Notes**: 需要可复现的知识点拆分逻辑

## Open Questions
- [ ] Git操作是否需要支持其他Git命令（如pull、commit）？
- [ ] 待办事项是否需要支持完成状态和提醒功能？
- [ ] 周报总结是否需要支持自定义时间范围？
- [ ] 知识点拆分的粒度如何定义？
