import { authedProcedure, createRouter } from "../middleware";
import { uploadImageInputSchema } from "../../contracts/media";
import { getDb } from "../../db/connection";
import { uploadImage } from "../services/mediaService";

/**
 * Media tRPC router (plan §5.2). Register as `media: mediaRouter` in
 * api/router.ts. There is intentionally no imageUrl procedure: clients store
 * keys and render through GET /api/board-image?key=...
 */
export const mediaRouter = createRouter({
  // Authenticated upload; master/player rights are enforced in the service
  // (plan §4.3). Bytes arrive as base64 — tRPC transports JSON.
  uploadImage: authedProcedure
    .input(uploadImageInputSchema)
    .mutation(({ ctx, input }) => uploadImage(getDb(), ctx.user, input)),
});
