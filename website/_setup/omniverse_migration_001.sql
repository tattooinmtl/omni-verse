-- Omniverse website: visits and connecting the Omniverse app to an account.
-- Database: globalw4_viteReact (shared with OmniOne and OmniBots).
-- Only adds Omniverse's own tables; nothing existing is changed.
-- Safe to import twice.

-- One row per page load. `counted` is 1 for a new visit (first load from that
-- IP in 30 minutes) and 0 for reloads, so the counter isn't inflated.
CREATE TABLE IF NOT EXISTS `omniverse_visits` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `ip` varchar(45) NOT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `path` varchar(255) DEFAULT NULL,
  `referrer` varchar(255) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `counted` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_omv_visits_ip_time` (`ip`, `created_at`),
  KEY `idx_omv_visits_counted` (`counted`, `created_at`),
  CONSTRAINT `fk_omv_visits_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The device-code flow, same shape as omni_device_codes.
CREATE TABLE IF NOT EXISTS `omniverse_device_codes` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `device_code_hash` char(64) NOT NULL,
  `user_code` char(9) NOT NULL,
  `device_uid` varchar(64) NOT NULL,
  `device_name` varchar(100) DEFAULT NULL,
  `device_os` varchar(100) DEFAULT NULL,
  `app_version` varchar(32) DEFAULT NULL,
  `status` enum('pending','approved','denied','consumed') NOT NULL DEFAULT 'pending',
  `user_id` int(11) DEFAULT NULL,
  `created_ip` varchar(45) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `expires_at` datetime NOT NULL,
  `decided_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_omv_dc_hash` (`device_code_hash`),
  KEY `idx_omv_dc_user_code` (`user_code`, `status`),
  CONSTRAINT `fk_omv_dc_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A connected copy of the Omniverse app: one live token per PC. Only the
-- token's SHA-256 is stored.
CREATE TABLE IF NOT EXISTS `omniverse_app_tokens` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `device_uid` varchar(64) NOT NULL,
  `device_name` varchar(100) DEFAULT NULL,
  `device_os` varchar(100) DEFAULT NULL,
  `app_version` varchar(32) DEFAULT NULL,
  `token_hash` char(64) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_used_at` datetime DEFAULT NULL,
  `last_ip` varchar(45) DEFAULT NULL,
  `revoked_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_omv_tok_hash` (`token_hash`),
  KEY `idx_omv_tok_user` (`user_id`, `device_uid`),
  CONSTRAINT `fk_omv_tok_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
