import type { ContentRating } from "@/data/library";

/**
 * 会话内已解锁到哪一档。
 *
 * 刻意放在模块级变量里，不走 zustand persist：
 * - 应用关掉 → 变量重置 → 下次启动仍需输密码（符合「关掉程序回到全年龄」的设计）
 * - 应用没关 → 切换到同一档或更低档时不再重复询问
 */
let unlockedLevel: ContentRating = 0;

/** 验证通过后调用，记录本次会话已解锁到这一档 */
export function markUnlocked(level: ContentRating) {
  if (level > unlockedLevel) {
    unlockedLevel = level;
  }
}

/** 这一档是否已经在本次会话中解锁过 */
export function isUnlocked(level: ContentRating) {
  return unlockedLevel >= level;
}

/** 仅供测试：重置会话解锁状态 */
export function resetUnlockedForTest() {
  unlockedLevel = 0;
}
