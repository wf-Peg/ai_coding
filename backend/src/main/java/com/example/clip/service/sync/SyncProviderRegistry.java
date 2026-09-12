package com.example.clip.service.sync;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 同步/备份方案注册表。
 * <p>
 * 通过 {@code List<SyncProvider>} 注入，Spring 自动收集所有实现 {@link SyncProvider}
 * 的 bean。新增方案时无需手动改注册逻辑——新增一个 {@code @Component implements SyncProvider}
 * 即被自动收集，前端「同步状态」面板即可动态发现并列出。
 * </p>
 *
 * @see SyncProvider
 */
@Component
public class SyncProviderRegistry {

    private static final Logger log = LoggerFactory.getLogger(SyncProviderRegistry.class);

    /** Spring 收集到的全部同步方案（按 type 建立索引，query 时 O(1)） */
    private final Map<String, SyncProvider> providers = new LinkedHashMap<>();

    public SyncProviderRegistry(List<SyncProvider> providerList) {
        if (providerList != null) {
            for (SyncProvider p : providerList) {
                if (p != null && p.getType() != null && !providers.containsKey(p.getType())) {
                    providers.put(p.getType(), p);
                    log.info("Registered sync provider: {} ({})", p.getType(), p.getDisplayName());
                }
            }
        }
    }

    /** 按类型获取方案；未知类型返回 null */
    public SyncProvider getByType(String type) {
        return type == null ? null : providers.get(type);
    }

    /** 返回全部已注册方案 */
    public List<SyncProvider> list() {
        return List.copyOf(providers.values());
    }

    /** 返回首个方案作为默认方案（通常为 Git）；无任何方案时返回 null */
    public SyncProvider defaultProvider() {
        return providers.values().iterator().hasNext() ? providers.values().iterator().next() : null;
    }
}