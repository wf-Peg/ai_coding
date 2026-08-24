package com.example.clip.util;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.DESKeySpec;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

/**
 * DES 加解密工具类。
 * <p>
 * 提供密码库文件的 DES 加密、解密、密钥生成和密钥校验功能。
 * 密钥以 Base64 编码字符串形式在前后端之间传递，不持久化存储。
 * </p>
 */
public class DesEncryptionUtil {

    private static final String ALGORITHM = "DES/ECB/PKCS5Padding";
    private static final String KEY_ALGORITHM = "DES";

    /**
     * 生成随机 DES 密钥（8 字节）
     *
     * @return Base64 编码的密钥字符串
     */
    public static String generateKey() {
        SecureRandom random = new SecureRandom();
        byte[] keyBytes = new byte[8];
        random.nextBytes(keyBytes);
        return Base64.getEncoder().encodeToString(keyBytes);
    }

    /**
     * 从任意字符串推导出 8 字节 DES 密钥。
     * <p>
     * 兼容两种输入：(1) 前端的 generateKey() 生成的 Base64 编码 8 字节密钥；
     * (2) 用户直接输入的任意密码字符串（通过 MD5 取前 8 字节）。
     * </p>
     *
     * @param input 用户输入的密钥字符串
     * @return 8 字节密钥
     */
    private static byte[] deriveKeyBytes(String input) {
        try {
            byte[] decoded = Base64.getDecoder().decode(input);
            if (decoded.length == 8) {
                return decoded;
            }
        } catch (IllegalArgumentException ignored) {
            // 不是合法的 Base64 → 作为普通密码处理
        }
        // 用户输入的是普通密码字符串 → MD5 取前 8 字节
        try {
            MessageDigest md5 = MessageDigest.getInstance("MD5");
            byte[] hash = md5.digest(input.getBytes("UTF-8"));
            return Arrays.copyOf(hash, 8);
        } catch (Exception e) {
            throw new RuntimeException("无法从输入推导 DES 密钥", e);
        }
    }

    /**
     * DES 加密
     *
     * @param plaintext 明文字符串
     * @param keyBase64 Base64 编码的 DES 密钥
     * @return Base64 编码的密文
     */
    public static String encrypt(String plaintext, String keyBase64) {
        try {
            byte[] keyBytes = deriveKeyBytes(keyBase64);
            DESKeySpec desKey = new DESKeySpec(keyBytes);
            SecretKeyFactory keyFactory = SecretKeyFactory.getInstance(KEY_ALGORITHM);
            SecretKey secureKey = keyFactory.generateSecret(desKey);
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, secureKey);
            byte[] encrypted = cipher.doFinal(plaintext.getBytes("UTF-8"));
            return Base64.getEncoder().encodeToString(encrypted);
        } catch (Exception e) {
            throw new RuntimeException("DES 加密失败", e);
        }
    }

    /**
     * DES 解密
     *
     * @param ciphertextBase64 Base64 编码的密文
     * @param keyBase64        Base64 编码的 DES 密钥
     * @return 明文字符串
     */
    public static String decrypt(String ciphertextBase64, String keyBase64) {
        try {
            byte[] keyBytes = deriveKeyBytes(keyBase64);
            DESKeySpec desKey = new DESKeySpec(keyBytes);
            SecretKeyFactory keyFactory = SecretKeyFactory.getInstance(KEY_ALGORITHM);
            SecretKey secureKey = keyFactory.generateSecret(desKey);
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, secureKey);
            byte[] decrypted = cipher.doFinal(Base64.getDecoder().decode(ciphertextBase64));
            return new String(decrypted, "UTF-8");
        } catch (Exception e) {
            throw new RuntimeException("DES 解密失败，请检查 Key 是否正确", e);
        }
    }

    /**
     * 生成 Key 校验哈希（SHA-256 前 8 位十六进制）
     * <p>
     * 用于验证用户输入的 Key 是否正确，不存储 Key 本身。
     * </p>
     *
     * @param keyBase64 Base64 编码的 DES 密钥
     * @return 8 字符十六进制哈希字符串
     */
    public static String getKeyCheckHash(String keyBase64) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(keyBase64.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 4; i++) {
                sb.append(String.format("%02x", hash[i]));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException("生成 Key 校验哈希失败", e);
        }
    }

    /**
     * 旧版 Key 校验哈希（使用 deriveKeyBytes），用于兼容迁移。
     */
    public static String getLegacyKeyCheckHash(String keyBase64) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(deriveKeyBytes(keyBase64));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 4; i++) {
                sb.append(String.format("%02x", hash[i]));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException("生成 Key 校验哈希失败", e);
        }
    }
}
