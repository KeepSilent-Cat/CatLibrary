import { invoke } from "@tauri-apps/api/core";

export type MobileAccessInfo = {
  /** 首选地址（默认路由网卡） */
  url: string;
  /** 所有可用地址，换网络后挑能连上的那个 */
  urls: string[];
  token: string;
  port: number;
};

/** 查询手机访问服务是否在运行 */
export function mobileAccessStatus() {
  return invoke<MobileAccessInfo | null>("mobile_access_status");
}

/** 启动内网只读服务（带当前显示范围，手机端跟随桌面端分级） */
export function startMobileAccess(
  resourceRoot: string,
  ratingFilter: number,
  itemRatings: Record<string, number>,
  reportRatings: Record<string, number>,
) {
  return invoke<MobileAccessInfo>("start_mobile_access", {
    resourceRoot,
    ratingFilter,
    itemRatings,
    reportRatings,
  });
}

/** 桌面端改了显示范围后，推给手机端立即生效 */
export function updateMobileFilter(
  ratingFilter: number,
  itemRatings: Record<string, number>,
  reportRatings: Record<string, number>,
) {
  return invoke<void>("update_mobile_filter", { ratingFilter, itemRatings, reportRatings });
}

/** 停止服务，token 立即失效 */
export function stopMobileAccess() {
  return invoke<void>("stop_mobile_access");
}
