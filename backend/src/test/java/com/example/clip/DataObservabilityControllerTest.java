package com.example.clip;

import com.example.clip.controller.DataObservabilityController;
import com.example.clip.service.AppConfigService;
import com.example.clip.service.ExceptionLogService;
import com.example.clip.service.FileStorageService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class DataObservabilityControllerTest {
    @TempDir
    Path tempDir;

    @Test
    void overviewReportsEmptyIndexDirectoryWithoutFailing() {
        AppConfigService configService = mock(AppConfigService.class);
        when(configService.getConfigDirPath()).thenReturn(tempDir.toString());
        DataObservabilityController controller = new DataObservabilityController(configService, mock(FileStorageService.class), mock(ExceptionLogService.class));

        var response = controller.overview();

        assertEquals(200, response.getStatusCode().value());
        assertNotNull(response.getBody());
        assertEquals(0, ((java.util.Map<?, ?>) response.getBody().get("contentIndex")).get("count"));
    }
}
