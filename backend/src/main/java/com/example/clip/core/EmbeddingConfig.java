//package com.example.clip.core;
//
//import org.springframework.ai.embedding.EmbeddingClient;
//import org.springframework.beans.factory.annotation.Value;
//import org.springframework.context.annotation.Bean;
//import org.springframework.context.annotation.Configuration;
//import org.springframework.context.annotation.Primary;
//
///**
// * Embedding配置类
// * 配置嵌入模型客户端
// */
//@Configuration
//public class EmbeddingConfig {
//
//    /**
//     * 嵌入模型提供者
//     */
//    @Value("${spring.ai.embedding.provider:openai}")
//    private String embeddingProvider;
//
//    // 暂时注释掉EmbeddingClient的Bean定义，让应用能够启动
//    // 实际使用时需要配置正确的embedding客户端
//    /*
//    /**
//     * 创建主要的EmbeddingClient实例
//     * @return EmbeddingClient实例
//     */
//    @Primary
//    @Bean
//    public EmbeddingClient embeddingClient() {
//        // 默认使用Spring AI内置的embedding模型
//        if ("openai".equals(embeddingProvider)) {
//            // 这里使用Spring AI的默认embedding客户端
//            // 实际使用时需要配置OpenAI API key
//            throw new UnsupportedOperationException("OpenAI embedding provider requires API key configuration");
//        }
//        // 预留阿里巴巴embedding模型的入口
//        else if ("alibaba".equals(embeddingProvider)) {
//            // 未来实现阿里巴巴embedding模型的集成
//            throw new UnsupportedOperationException("Alibaba embedding provider is not yet implemented");
//        }
//        else {
//            throw new IllegalArgumentException("Unsupported embedding provider: " + embeddingProvider);
//        }
//    }
//
//    /**
//     * 为阿里巴巴embedding模型提供单独的Bean
//     * @return EmbeddingClient实例
//     */
//    @Bean
//    public EmbeddingClient alibabaEmbeddingClient() {
//        // 未来实现阿里巴巴embedding模型的集成
//        throw new UnsupportedOperationException("Alibaba embedding provider is not yet implemented");
//    }
//    */
//}
