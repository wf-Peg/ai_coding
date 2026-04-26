// 事件监听器
document.addEventListener('DOMContentLoaded', function() {
    // 初始化 marked
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            breaks: true,
            gfm: true
        });
    }
    
    // 确认弹窗
    document.getElementById('close-confirm-btn').addEventListener('click', closeConfirmModal);
    
    // 提示配置弹窗
    document.getElementById('close-prompt-config-btn').addEventListener('click', closePromptConfigModal);
    document.getElementById('close-prompt-config-btn-footer').addEventListener('click', closePromptConfigModal);
    document.getElementById('reset-prompt-config-btn').addEventListener('click', resetPromptConfig);
    document.getElementById('save-prompt-config-btn').addEventListener('click', savePromptConfig);
    
    // 反馈弹窗
    document.getElementById('close-feedback-btn').addEventListener('click', closeFeedbackModal);
    document.getElementById('close-feedback-btn-footer').addEventListener('click', closeFeedbackModal);
    document.getElementById('copy-path-btn').addEventListener('click', copyFeedbackPath);
    
    // Git配置
    document.getElementById('open-git-config-btn').addEventListener('click', openGitConfigModal);
    document.getElementById('sync-btn').addEventListener('click', syncGit);
    
    // 整理内容
    document.getElementById('open-daily-prompt-btn').addEventListener('click', function() { openPromptConfigModal('daily'); });
    document.getElementById('organize-btn').addEventListener('click', organizeContent);
    
    // 周报生成
    document.getElementById('open-weekly-prompt-btn').addEventListener('click', function() { openPromptConfigModal('weekly'); });
    document.getElementById('weekly-report-btn').addEventListener('click', generateWeeklyReport);
    
    // 模式切换
    document.getElementById('toggle-btn').addEventListener('click', toggleMode);
    
    // 通知
    document.getElementById('open-folder-btn').addEventListener('click', openStorageFolder);
    document.getElementById('close-notification-btn').addEventListener('click', closeNotification);
});