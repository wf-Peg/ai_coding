package com.example.clip.core;

/**
 * 可取消的 LLM 流式请求句柄。
 */
public interface ChatStreamHandle {

    void cancel();

    boolean isCancelled();
}
