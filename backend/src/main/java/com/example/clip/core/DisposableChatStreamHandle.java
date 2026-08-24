package com.example.clip.core;

import io.reactivex.disposables.Disposable;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 基于 RxJava Disposable 的流式请求句柄。
 */
public final class DisposableChatStreamHandle implements ChatStreamHandle {

    private final AtomicReference<Disposable> disposable = new AtomicReference<>();
    private final AtomicBoolean cancelled = new AtomicBoolean();

    public void setDisposable(Disposable value) {
        if (cancelled.get()) {
            value.dispose();
            return;
        }
        disposable.set(value);
        if (cancelled.get()) {
            value.dispose();
        }
    }

    @Override
    public void cancel() {
        cancelled.set(true);
        Disposable value = disposable.get();
        if (value != null) {
            value.dispose();
        }
    }

    @Override
    public boolean isCancelled() {
        Disposable value = disposable.get();
        return cancelled.get() || (value != null && value.isDisposed());
    }
}
