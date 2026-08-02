package com.example.clip;

import com.example.clip.controller.ModelConfigController;
import com.example.clip.core.DashScopeConfig;
import com.example.clip.service.ModelConfigService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * 测试新增的 presets 接口和 custom provider 测试连接接口
 * <p>
 * 使用 {@link WebMvcTest} 仅加载 Web 层，通过 {@link Import} 引入
 * {@link DashScopeConfig} 获取真实的 {@link com.alibaba.dashscope.aigc.generation.Generation} Bean，
 * 避免 Mockito 无法 mock final class 的问题。
 * </p>
 */
@WebMvcTest(ModelConfigController.class)
@Import(DashScopeConfig.class)
class ModelConfigControllerCustomTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ModelConfigService modelConfigService;

    @Test
    void getPresets_returnsPresetList() throws Exception {
        mockMvc.perform(get("/api/model-config/presets")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(greaterThanOrEqualTo(6))))
                .andExpect(jsonPath("$[*].id", hasItems("dashscope", "deepseek", "openrouter", "siliconflow", "glm", "moonshot", "ollama", "custom")))
                .andExpect(jsonPath("$[0].id").value("dashscope"))
                .andExpect(jsonPath("$[0].name").value("阿里云 DashScope"))
                .andExpect(jsonPath("$[0].baseUrl").value("https://dashscope.aliyuncs.com/compatible-mode/v1"))
                .andExpect(jsonPath("$[0].defaultModel").value("qwen-plus"))
                .andExpect(jsonPath("$[1].id").value("deepseek"))
                .andExpect(jsonPath("$[1].name").value("DeepSeek"))
                .andExpect(jsonPath("$[1].baseUrl").value("https://api.deepseek.com/v1"))
                .andExpect(jsonPath("$[1].defaultModel").value("deepseek-v4-flash"));
    }

    @Test
    void testCustomConnection_withBaseUrl() throws Exception {
        // custom provider 的 baseUrl 无法实际连接，验证返回结构即可
        mockMvc.perform(post("/api/model-config/test")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"provider\":\"custom\",\"baseUrl\":\"http://localhost:11434/v1\",\"apiKey\":\"sk-test\",\"model\":\"llama3\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").isNotEmpty())
                .andExpect(jsonPath("$.message").isNotEmpty());
    }

    @Test
    void testCustomConnection_withoutBaseUrl_returnsFailure() throws Exception {
        // 不传 baseUrl 时，应触发验证错误并返回失败
        mockMvc.perform(post("/api/model-config/test")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"provider\":\"custom\",\"apiKey\":\"sk-test\",\"model\":\"llama3\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message", containsString("请先填写 API 地址")));
    }

    @Test
    void testCustomConnection_withoutApiKey_returnsFailure() throws Exception {
        // 不传 apiKey 时，应触发验证错误并返回失败
        mockMvc.perform(post("/api/model-config/test")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"provider\":\"custom\",\"baseUrl\":\"http://localhost:11434/v1\",\"model\":\"llama3\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message", containsString("请先填写 API Key")));
    }
}