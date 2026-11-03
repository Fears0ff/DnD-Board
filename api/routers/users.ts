import { createRouter, masterProcedure } from "../middleware";
import { setGameRoleInputSchema } from "../../contracts/auth";
import { getDb } from "../../db/connection";
import { listUsers, toUserDto } from "../repositories/users";
import { setGameRole } from "../services/userService";

export const usersRouter = createRouter({
  // Only the master sees the user list.
  list: masterProcedure.query(() => listUsers(getDb()).map(toUserDto)),

  // Master-only; demoting the last master fails transactionally (409).
  setGameRole: masterProcedure
    .input(setGameRoleInputSchema)
    .mutation(({ input }) =>
      toUserDto(setGameRole(getDb(), input.userId, input.gameRole)),
    ),
});
