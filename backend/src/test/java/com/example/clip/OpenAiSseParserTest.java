package com.example.clip;

import com.example.clip.core.OpenAiSseParser;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class OpenAiSseParserTest {

    @Test
    void parsesEventsSplitAcrossNetworkChunks() {
        List<String> deltas = new ArrayList<>();
        List<Boolean> completed = new ArrayList<>();
        OpenAiSseParser parser = new OpenAiSseParser(new ObjectMapper(), deltas::add,
                () -> completed.add(true));

        parser.accept("data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\ndata: {\"cho");
        parser.accept("ices\":[{\"delta\":{\"content\":\"好\"}}]}\n\ndata: [DONE]\n\n");

        assertEquals(List.of("你", "好"), deltas);
        assertEquals(1, completed.size());
    }

    @Test
    void ignoresHeartbeatAndEmptyDelta() {
        List<String> deltas = new ArrayList<>();
        OpenAiSseParser parser = new OpenAiSseParser(new ObjectMapper(), deltas::add, () -> {});

        parser.accept(": heartbeat\n\ndata: {\"choices\":[{\"delta\":{}}]}\n\n");
        parser.finish();

        assertEquals(List.of(), deltas);
    }
}
