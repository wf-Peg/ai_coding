package com.example.clip.core;

import com.alibaba.dashscope.aigc.generation.Generation;
import com.alibaba.dashscope.aigc.generation.GenerationParam;
import com.alibaba.dashscope.aigc.generation.GenerationResult;
import com.alibaba.dashscope.common.Message;
import com.alibaba.dashscope.common.Role;
import com.example.clip.service.ModelConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Arrays;

/**
 * 阿里云 DashScope（百炼）大模型提供者实现。
 * <p>
 * 封装阿里云 DashScope SDK（dashscope-sdk-java）的调用逻辑，
 * 实现 {@link LlmProvider} 接口，提供统一的对话能力。
 * 使用 {@link Generation} SDK 进行非流式文本生成调用。
 * </p>
 *
 * <h3>API Key 和模型选择优先级</h3>
 * <ol>
 *   <li>优先使用 {@link ModelConfig} 中用户自定义的 API Key 和模型名称</li>
 *   <li>如果用户未配置，回退到 {@code application.yml} 中的默认配置</li>
 * </ol>
 *
 * <h3>调用流程</h3>
 * <ol>
 *   <li>获取 API Key 和模型名称（按优先级）</li>
 *   <li>构建系统消息（Role.SYSTEM）和用户消息（Role.USER）</li>
 *   <li>构建 {@link GenerationParam} 参数对象</li>
 *   <li>调用 {@link Generation#call(GenerationParam)} 执行同步请求</li>
 *   <li>从返回结果中提取第一个 choice 的消息内容</li>
 * </ol>
 *
 * <p>
 * 注意：当前实现使用同步调用方式，会阻塞当前线程直到 API 返回。
 * 如果调用方需要异步处理，应在上层（如 {@link AiService}）使用
 * {@code @Async} 或 CompletableFuture 实现。
 * </p>
 */
@Component
public class DashScopeLlmProvider implements LlmProvider {

    private static final Logger logger = LoggerFactory.getLogger(DashScopeLlmProvider.class);

    /** DashScope SDK 的核心调用对象，由 {@link DashScopeConfig} 创建并注入 */
    private final Generation generation;

    /** DashScope 默认配置（yml 中的值） */
    private final DashScopeConfig dashScopeConfig;

    /** 模型配置服务，用于获取用户自定义的配置 */
    private final ModelConfigService modelConfigService;

    /**
     * 构造器注入所有依赖。
     *
     * @param generation         DashScope SDK Generation 实例
     * @param dashScopeConfig    DashScope yml 默认配置
     * @param modelConfigService 模型配置服务
     */
    public DashScopeLlmProvider(Generation generation, DashScopeConfig dashScopeConfig,
                                ModelConfigService modelConfigService) {
        this.generation = generation;
        this.dashScopeConfig = dashScopeConfig;
        this.modelConfigService = modelConfigService;
    }

    /**
     * 调用 DashScope API 进行对话。
     * <p>
     * 使用非流式调用方式，将系统提示词和用户消息发送给 DashScope，
     * 等待完整响应后返回第一候选回复的内容。
     * </p>
     *
     * @param systemPrompt 系统提示词，设定模型角色和行为
     * @param userMessage  用户消息，需要模型处理的内容
     * @return 模型生成的文本回复
     * @throws RuntimeException 当 API 调用失败或返回异常时抛出
     */
    @Override
    public String chat(String systemPrompt, String userMessage) {
        try {
            // 构建系统消息：设定 AI 的角色和行为规范
            Message systemMessage = Message.builder()
                    .role(Role.SYSTEM.getValue())
                    .content(systemPrompt)
                    .build();

            // 构建用户消息：用户实际要处理的内容
            Message userMsg = Message.builder()
                    .role(Role.USER.getValue())
                    .content(userMessage)
                    .build();

            // 构建调用参数：API Key、模型名称、消息列表、返回格式
            GenerationParam param = GenerationParam.builder()
                    .apiKey(getApiKey())                          // 获取 API Key（用户配置优先）
                    .model(getModel())                             // 获取模型名称（用户配置优先）
                    .messages(Arrays.asList(systemMessage, userMsg)) // 消息列表，按 system -> user 顺序
                    .resultFormat(GenerationParam.ResultFormat.MESSAGE) // 返回格式为 Message 类型
                    .build();

            // 同步调用 DashScope API，阻塞等待结果
            GenerationResult result = generation.call(param);

            // 从结果中提取：output -> choices[0] -> message -> content
            return result.getOutput().getChoices().get(0).getMessage().getContent();
        } catch (Exception e) {
            // 记录完整错误信息，包括堆栈跟踪，便于排查问题
            logger.error("[DashScope] chat failed: {}", e.getMessage(), e);
            // 包装为 RuntimeException 向上抛出，由调用方统一处理
            throw new RuntimeException("DashScope 调用失败: " + e.getMessage(), e);
        }
    }

    /**
     * 获取提供者名称。
     *
     * @return 固定返回 "dashscope"
     */
    @Override
    public String getProviderName() {
        return "dashscope";
    }

    /**
     * 判断 DashScope 是否可用。
     * <p>
     * 检查 API Key 是否已配置且非空。
     * 注意：此方法会检查用户配置和 yml 配置，任一有值即可。
     * </p>
     *
     * @return true 表示 API Key 已配置，可以正常调用
     */
    @Override
    public boolean isAvailable() {
        return getApiKey() != null && !getApiKey().isEmpty();
    }

    /**
     * 获取 API Key，按优先级：用户配置 > yml 配置。
     * <p>
     * 先检查 {@link ModelConfig} 中用户是否配置了 DashScope API Key，
     * 如果用户配置了且非空，则使用用户配置；否则使用 yml 中的默认配置。
     * 这样可以实现：用户不改配置时使用默认 Key，改了则覆盖。
     * </p>
     *
     * @return 有效的 API Key，可能为空字符串
     */
    private String getApiKey() {
        ModelConfig config = modelConfigService.getConfig();
        // 用户配置的 API Key 存在且非空时优先使用
        if (config != null && config.getDashscopeApiKey() != null && !config.getDashscopeApiKey().isEmpty()) {
            return config.getDashscopeApiKey();
        }
        // 回退到 yml 默认配置
        return dashScopeConfig.getApiKey();
    }

    /**
     * 获取模型名称，按优先级：用户配置 > yml 配置。
     * <p>
     * 先检查 {@link ModelConfig} 中用户是否配置了 DashScope 模型名称，
     * 如果用户配置了且非空，则使用用户配置；否则使用 yml 中的默认配置。
     * </p>
     *
     * @return 有效的模型名称，如 "qwen-plus"、"qwen-max" 等
     */
    private String getModel() {
        ModelConfig config = modelConfigService.getConfig();
        // 用户配置的模型名称存在且非空时优先使用
        if (config != null && config.getDashscopeModel() != null && !config.getDashscopeModel().isEmpty()) {
            return config.getDashscopeModel();
        }
        // 回退到 yml 默认配置
        return dashScopeConfig.getModel();
    }
}