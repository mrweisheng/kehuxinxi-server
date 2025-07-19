/*
 Navicat Premium Dump SQL

 Source Server         : huaxing
 Source Server Type    : MySQL
 Source Server Version : 80042 (8.0.42-0ubuntu0.24.04.1)
 Source Host           : 47.113.177.228:3306
 Source Schema         : kehuxinxi

 Target Server Type    : MySQL
 Target Server Version : 80042 (8.0.42-0ubuntu0.24.04.1)
 File Encoding         : 65001

 Date: 19/07/2025 10:24:16
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for customer_leads
-- ----------------------------
DROP TABLE IF EXISTS `customer_leads`;
CREATE TABLE `customer_leads`  (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键，自增ID',
  `customer_nickname` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '客户昵称',
  `source_platform` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '客户来源平台（如抖音、微信等）',
  `source_account` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '客户来源账号（如某抖音号、公众号等）',
  `contact_account` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '客户联系方式（手机号、微信号等）',
  `lead_time` varchar(19) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '进线索时间',
  `is_contacted` tinyint(1) NOT NULL COMMENT '是否联系上（0=否，1=是）',
  `intention_level` enum('高','中','低') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '意向等级',
  `follow_up_person` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '跟进人',
  `is_deal` tinyint(1) NOT NULL COMMENT '是否成交（0=否，1=是）',
  `deal_date` varchar(19) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '成交日期，仅在成交时填写',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `need_followup` tinyint(1) NOT NULL DEFAULT 0 COMMENT '当前周期是否需要跟进（1=是，0=否）',
  `end_followup` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否终结跟进（1=终结，0=未终结）',
  `end_followup_reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '终结跟进原因',
  `current_follower` int NULL DEFAULT NULL COMMENT '当前跟进人用户ID',
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 36 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '客资主表（线索表）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for follow_up_records
-- ----------------------------
DROP TABLE IF EXISTS `follow_up_records`;
CREATE TABLE `follow_up_records`  (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键，自增ID',
  `lead_id` int NOT NULL COMMENT '关联的客资ID',
  `follow_up_time` varchar(19) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '跟进时间',
  `follow_up_method` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '跟进方式（如电话、微信、线下等）',
  `follow_up_content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT '跟进内容/备注',
  `follow_up_result` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '跟进结果/状态',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `follow_up_person_id` int NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `lead_id`(`lead_id` ASC) USING BTREE,
  CONSTRAINT `follow_up_records_ibfk_1` FOREIGN KEY (`lead_id`) REFERENCES `customer_leads` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 58 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '跟进记录表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for followup_remind_config
-- ----------------------------
DROP TABLE IF EXISTS `followup_remind_config`;
CREATE TABLE `followup_remind_config`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `intention_level` enum('高','中','低') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '意向等级',
  `interval_days` int NOT NULL COMMENT '最大未跟进天数',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `intention_level`(`intention_level` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '跟进超期提醒配置' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for operation_logs
-- ----------------------------
DROP TABLE IF EXISTS `operation_logs`;
CREATE TABLE `operation_logs`  (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键，自增ID',
  `operation_time` datetime NOT NULL COMMENT '操作时间',
  `operation_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作类型（新增、修改、删除、跟进等）',
  `operation_content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT '操作内容/详情',
  `lead_id` int NULL DEFAULT NULL COMMENT '关联的客资ID（如涉及某条线索则记录）',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `lead_id`(`lead_id` ASC) USING BTREE,
  CONSTRAINT `operation_logs_ibfk_1` FOREIGN KEY (`lead_id`) REFERENCES `customer_leads` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '操作日志表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for remind_email_list
-- ----------------------------
DROP TABLE IF EXISTS `remind_email_list`;
CREATE TABLE `remind_email_list`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '收件人邮箱',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `email`(`email` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 3 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '超期提醒收件人列表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for users
-- ----------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users`  (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键，自增ID',
  `username` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '用户名，唯一',
  `password` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '密码（加密存储）',
  `nickname` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '昵称',
  `role` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT 'user' COMMENT '角色（user/admin等）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `username`(`username` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 6 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '用户表' ROW_FORMAT = Dynamic;

SET FOREIGN_KEY_CHECKS = 1;
