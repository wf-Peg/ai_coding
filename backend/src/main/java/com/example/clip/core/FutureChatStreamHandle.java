package com.example.clip.core;

import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 基于 Future 的流式请求句柄。
 */
public final class FutureChatStreamHandle implements ChatStreamHandle {

    private final Future<?> future;
    private final AtomicBoolean cancelled = new AtomicBoolean();

    public FutureChatStreamHandle(Future<?> future) {
        this.future = future;
    }

    @Override
    public void cancel() {
        if (cancelled.compareAndSet(false, true)) {
            future.cancel(true);
        }
    }

    @Override
    public boolean isCancelled() {
        return cancelled.get() || future.isCancelled();
    }
}
