import { getDatabase } from "@/lib/turso-db";

type Database = ReturnType<typeof getDatabase>;

export async function removeMatchAndScheduleItem(
  database: Database,
  matchId?: string,
  scheduleItemId?: string,
) {
  return database.transaction(async (transaction) => {
    let scheduleItem: {
      id: string;
      tournament_id: string;
      item_type: string;
      match_id: string | null;
    } | null = null;

    if (scheduleItemId) {
      const item = await transaction
        .prepare("SELECT id,tournament_id,item_type,match_id FROM schedule_items WHERE id=?")
        .bind(scheduleItemId)
        .first<{
          id: string;
          tournament_id: string;
          item_type: string;
          match_id: string | null;
        }>();
      if (!item)
        return {
          notFound: true as const,
          locked: false,
          deletedMatch: false,
          matchId: undefined,
        };
      scheduleItem = item;
      if (scheduleItem.item_type !== "match" || !scheduleItem.match_id) {
        await transaction
          .prepare("DELETE FROM schedule_items WHERE id=?")
          .bind(scheduleItemId)
          .run();
        return {
          notFound: false as const,
          locked: false,
          deletedMatch: false,
          matchId: undefined,
        };
      }
      matchId = scheduleItem.match_id;
    }

    if (!matchId)
      return {
        notFound: true as const,
        locked: false,
        deletedMatch: false,
        matchId: undefined,
      };

    const match = await transaction
      .prepare("SELECT id,tournament_id,confirmed FROM matches WHERE id=?")
      .bind(matchId)
      .first<{ id: string; tournament_id: string; confirmed: number }>();
    if (!match) {
      if (scheduleItemId) {
        await transaction
          .prepare("DELETE FROM schedule_items WHERE id=?")
          .bind(scheduleItemId)
          .run();
      } else {
        await transaction
          .prepare("DELETE FROM schedule_items WHERE match_id=?")
          .bind(matchId)
          .run();
      }
      return {
        notFound: !scheduleItemId,
        locked: false,
        deletedMatch: false,
        matchId,
      };
    }
    if (scheduleItem && scheduleItem.tournament_id !== match.tournament_id)
      return {
        notFound: true as const,
        locked: false,
        deletedMatch: false,
        matchId,
      };
    if (Number(match.confirmed))
      return {
        notFound: false as const,
        locked: true as const,
        deletedMatch: false,
        matchId,
      };

    await transaction
      .prepare("DELETE FROM schedule_items WHERE match_id=?")
      .bind(matchId)
      .run();
    await transaction
      .prepare("DELETE FROM goal_events WHERE match_id=?")
      .bind(matchId)
      .run();
    await transaction
      .prepare("DELETE FROM match_events WHERE match_id=?")
      .bind(matchId)
      .run();
    const deleted = await transaction
      .prepare("DELETE FROM matches WHERE id=? AND confirmed=0")
      .bind(matchId)
      .run();
    if (!deleted.meta.changes)
      throw new Error("Match changed while it was being deleted");

    return {
      notFound: false as const,
      locked: false,
      deletedMatch: true,
      matchId,
    };
  });
}
