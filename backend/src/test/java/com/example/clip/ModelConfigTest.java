package com.example.clip;

import com.example.clip.core.ModelConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ModelConfigTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void serializesCustomFields() throws Exception {
        ModelConfig config = new ModelConfig();
        config.setActiveProvider("custom");
        config.setCustomProviderName("我的中转站");
        config.setCustomBaseUrl("https://one-api.example.com/v1");
        config.setCustomApiKey("sk-custom-key");
        config.setCustomModel("gpt-4");

        String json = mapper.writeValueAsString(config);
        assertTrue(json.contains("\"customProviderName\":\"我的中转站\""));
        assertTrue(json.contains("\"customBaseUrl\":\"https://one-api.example.com/v1\""));
        assertTrue(json.contains("\"customApiKey\":\"sk-custom-key\""));
        assertTrue(json.contains("\"customModel\":\"gpt-4\""));
    }

    @Test
    void deserializesCustomFields() throws Exception {
        String json = "{\"activeProvider\":\"custom\",\"customProviderName\":\"测试\",\"customBaseUrl\":\"http://localhost:11434/v1\",\"customApiKey\":\"sk-test\",\"customModel\":\"llama3\"}";

        ModelConfig config = mapper.readValue(json, ModelConfig.class);
        assertEquals("custom", config.getActiveProvider());
        assertEquals("测试", config.getCustomProviderName());
        assertEquals("http://localhost:11434/v1", config.getCustomBaseUrl());
        assertEquals("sk-test", config.getCustomApiKey());
        assertEquals("llama3", config.getCustomModel());
    }

    @Test
    void getActiveApiKeyReturnsCustomKeyWhenActiveProviderIsCustom() {
        ModelConfig config = new ModelConfig();
        config.setActiveProvider("custom");
        config.setCustomApiKey("sk-custom-key");
        config.setDeepseekApiKey("sk-deepseek");
        config.setDashscopeApiKey("sk-dashscope");

        assertEquals("sk-custom-key", config.getActiveApiKey());
    }

    @Test
    void getActiveModelReturnsCustomModelWhenActiveProviderIsCustom() {
        ModelConfig config = new ModelConfig();
        config.setActiveProvider("custom");
        config.setCustomModel("gpt-4");
        config.setDeepseekModel("deepseek-v4-flash");
        config.setDashscopeModel("qwen-plus");

        assertEquals("gpt-4", config.getActiveModel());
    }

    @Test
    void defaultsAreEmpty() {
        ModelConfig config = new ModelConfig();
        assertEquals("", config.getCustomProviderName());
        assertEquals("", config.getCustomBaseUrl());
        assertEquals("", config.getCustomApiKey());
        assertEquals("", config.getCustomModel());
    }

    @Test
    void getActiveApiKeyReturnsDeepseekWhenActiveProviderIsDeepseek() {
        ModelConfig config = new ModelConfig();
        config.setActiveProvider("deepseek");
        config.setDeepseekApiKey("sk-deepseek");

        assertEquals("sk-deepseek", config.getActiveApiKey());
    }

    @Test
    void getActiveApiKeyReturnsDashscopeByDefault() {
        ModelConfig config = new ModelConfig();
        config.setActiveProvider("dashscope");
        config.setDashscopeApiKey("sk-dashscope");

        assertEquals("sk-dashscope", config.getActiveApiKey());
    }
}