import { trpc } from "@/providers/trpc";
import type { MutationHook } from "./api";
import type { MediaAssetDto, UploadImageInput } from "@contracts/media";
import { IMAGE_MAX_BYTES } from "@contracts/media";

/**
 * Медиа-фасад поверх tRPC. api.media и boards.setBackground пока не входят в
 * ApiFacade (src/lib/api.ts не редактируем), поэтому здесь — тот же приём,
 * что и в фасаде: типизированное приведение прокси. Как только роутер
 * зарегистрирован (media: mediaRouter, boards.setBackground), вызовы работают
 * без изменений.
 */
const extraApi = trpc as unknown as {
  media: {
    uploadImage: MutationHook<UploadImageInput, MediaAssetDto>;
  };
  boards: {
    setBackground: MutationHook<{ id: number; imageKey: string | null }, unknown>;
  };
};

export const mediaApi = extraApi.media;
export const boardBackgroundApi = extraApi.boards;

/**
 * URL раздачи по ключу. Ключи неизменяемы (immutable-кэш на сервере), поэтому
 * URL стабилен и безопасен для кэширования в <img>/canvas.
 */
export function boardImageUrl(key: string): string {
  return `/api/board-image?key=${encodeURIComponent(key)}`;
}

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Клиентская предварительная проверка; реальная валидация — на сервере. */
export function validatePickedImage(file: File): string | null {
  if (!ACCEPTED_TYPES.has(file.type)) {
    return "Поддерживаются только PNG, JPEG и WebP";
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return "Файл больше 15 МиБ";
  }
  return null;
}

export const IMAGE_ACCEPT_ATTR = "image/png,image/jpeg,image/webp";

/** File → base64 без data:-префикса (контракт media.uploadImage). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}
