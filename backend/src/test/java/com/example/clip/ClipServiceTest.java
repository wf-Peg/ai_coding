//package com.example.clip;
//
//import com.example.clip.core.AiService;
//import com.example.clip.dto.ClipRequest;
//import com.example.clip.dto.OrganizeInboxRequest;
//import com.example.clip.model.ClipContent;
//import com.example.clip.service.ClipService;
//import com.example.clip.service.DocumentParseService;
//import com.example.clip.service.FileStorageService;
//import com.example.clip.service.LinkParseService;
//import com.example.clip.utils.ImageUtils;
//import org.junit.jupiter.api.BeforeEach;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.ArgumentCaptor;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//
//import java.util.List;
//import java.util.Map;
//
//import static org.assertj.core.api.Assertions.assertThat;
//import static org.mockito.ArgumentMatchers.any;
//import static org.mockito.ArgumentMatchers.anyBoolean;
//import static org.mockito.ArgumentMatchers.anyString;
//import static org.mockito.Mockito.never;
//import static org.mockito.Mockito.verify;
//import static org.mockito.Mockito.when;
//
//@ExtendWith(MockitoExtension.class)
//class ClipServiceTest {
//
//    @Mock
//    private FileStorageService storageService;
//
//    @Mock
//    private AiService aiService;
//
//    @Mock
//    private LinkParseService linkParseService;
//
//    @Mock
//    private DocumentParseService documentParseService;
//
//    @Mock
//    private ImageUtils imageUtils;
//
//    private ClipService clipService;
//
//    @BeforeEach
//    void setUp() {
//        clipService = new ClipService(storageService, aiService, linkParseService, documentParseService, imageUtils);
//        when(storageService.saveClip(any(ClipContent.class))).thenAnswer(invocation -> invocation.getArgument(0));
//    }
//
//    @Test
//    void storeOnlyClipGoesToInboxWithoutAiProcessing() {
//        ClipRequest request = new ClipRequest();
//        request.setType("store-only");
//        request.setContent("raw inbox text");
//        request.setSource("manual");
//        request.setCaptureMethod("popup");
//
//        ClipContent saved = clipService.saveClip(request);
//
//        assertThat(saved.getType()).isEqualTo("store-only");
//        assertThat(saved.getWorkflowStatus()).isEqualTo(ClipService.WORKFLOW_INBOX);
//        assertThat(saved.getSummary()).isEqualTo("raw inbox text");
//        assertThat(saved.getAnalysis()).isEmpty();
//        verify(aiService, never()).processClipContent(anyString(), anyBoolean());
//    }
//
//    @Test
//    void aiTextClipKeepsAiFlowEvenWhenStructuredCaptureFieldsExist() {
//        when(aiService.processClipContent("article text", true)).thenReturn(Map.of(
//                "summary", "ai summary",
//                "analysis", "ai analysis",
//                "tags", List.of("ai"),
//                "category", "work-company"
//        ));
//
//        ClipRequest request = new ClipRequest();
//        request.setType("ai-text");
//        request.setContent("article text");
//        request.setSourceUrl("https://example.com/a");
//        request.setTitle("Article title");
//        request.setCaptureMethod("shortcut");
//
//        ClipContent saved = clipService.saveClip(request);
//
//        assertThat(saved.getType()).isEqualTo("ai-text");
//        assertThat(saved.getWorkflowStatus()).isEqualTo(ClipService.WORKFLOW_ORGANIZED);
//        assertThat(saved.getSummary()).isEqualTo("ai summary");
//        assertThat(saved.getAnalysis()).isEqualTo("ai analysis");
//        assertThat(saved.getCategory()).isEqualTo("work-company");
//        verify(aiService).processClipContent("article text", true);
//    }
//
//    @Test
//    void organizeInboxAutoOnlyProcessesStoreOnlyInboxClips() {
//        ClipContent inboxStoreOnly = new ClipContent("raw inbox text", "store-only", "manual", "default");
//        inboxStoreOnly.setId(1L);
//        inboxStoreOnly.setWorkflowStatus(ClipService.WORKFLOW_INBOX);
//
//        ClipContent inboxAiText = new ClipContent("already ai", "ai-text", "manual", "work-company");
//        inboxAiText.setId(2L);
//        inboxAiText.setWorkflowStatus(ClipService.WORKFLOW_INBOX);
//
//        ClipContent organizedStoreOnly = new ClipContent("old raw", "store-only", "manual", "default");
//        organizedStoreOnly.setId(3L);
//        organizedStoreOnly.setWorkflowStatus(ClipService.WORKFLOW_ORGANIZED);
//
//        when(storageService.getAllClips()).thenReturn(List.of(inboxStoreOnly, inboxAiText, organizedStoreOnly));
//        when(aiService.processClipContent("raw inbox text", true)).thenReturn(Map.of(
//                "summary", "organized summary",
//                "analysis", "organized analysis",
//                "tags", List.of("tag1", "tag2"),
//                "category", "life-learning"
//        ));
//        when(storageService.replaceClip(any(ClipContent.class))).thenAnswer(invocation -> invocation.getArgument(0));
//
//        Map<String, Object> result = clipService.organizeInbox(new OrganizeInboxRequest());
//
//        assertThat(result).containsEntry("status", "success").containsEntry("organizedCount", 1);
//        ArgumentCaptor<ClipContent> captor = ArgumentCaptor.forClass(ClipContent.class);
//        verify(storageService).replaceClip(captor.capture());
//        ClipContent organized = captor.getValue();
//        assertThat(organized.getId()).isEqualTo(1L);
//        assertThat(organized.getType()).isEqualTo("ai-text");
//        assertThat(organized.getWorkflowStatus()).isEqualTo(ClipService.WORKFLOW_ORGANIZED);
//        assertThat(organized.getSummary()).isEqualTo("organized summary");
//        assertThat(organized.getAnalysis()).isEqualTo("organized analysis");
//        assertThat(organized.getCategory()).isEqualTo("life-learning");
//        assertThat(organized.getTags()).containsExactly("tag1", "tag2");
//        verify(aiService).processClipContent("raw inbox text", true);
//    }
//}
