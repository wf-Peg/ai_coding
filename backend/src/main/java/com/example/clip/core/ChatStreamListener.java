package com.example.clip.core;

/**
 * LLM 流式输出回调。
 */
public interface ChatStreamListener {

    void onDelta(String content);

    void onComplete();

    void onError(Throwable error);
}
