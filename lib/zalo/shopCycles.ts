import { runWithShop } from "@/lib/shops/context";
import type { ShopInfo } from "@/lib/shops/registry";

export interface ShopCycles {
  waybill: () => Promise<{ processed: number; confirmed: number } | null>;
  cancelReceipt: () => Promise<{ processed: number; matched: number } | null>;
  overdue: () => Promise<{ newlyWarned: number } | null>;
}

type Logger = Pick<Console, "log" | "error">;

// One pass of the Zalo poller over every shop: each shop's groups, cursors and orders
// are its own, so each shop's cycles run inside that shop's scope. A failure — Zalo
// bridge down, a deleted group — is logged with the shop's name and stops only that
// step of that shop. `overdueDue` says whether the (hourly) overdue check is due for
// a shop; it is asked once per shop per pass.
export async function runShopCycles(
  shops: Pick<ShopInfo, "slug" | "name">[],
  cycles: ShopCycles,
  overdueDue: (slug: string) => boolean,
  log: Logger = console
): Promise<void> {
  for (const shop of shops) {
    const label = `[zalo-poller] ${shop.name} (${shop.slug})`;
    const wantsOverdue = overdueDue(shop.slug);

    await runWithShop(shop.slug, async () => {
      try {
        const result = await cycles.waybill();
        if (result && (result.processed > 0 || result.confirmed > 0)) {
          log.log(`${label} waybill: processed ${result.processed} message(s), ${result.confirmed} confirmation(s)`);
        }
      } catch (error) {
        log.error(`${label} waybill cycle failed:`, error);
      }

      try {
        const result = await cycles.cancelReceipt();
        if (result && (result.processed > 0 || result.matched > 0)) {
          log.log(`${label} cancel-receipt: processed ${result.processed} message(s), ${result.matched} order(s) matched`);
        }
      } catch (error) {
        log.error(`${label} cancel-receipt cycle failed:`, error);
      }

      if (wantsOverdue) {
        try {
          const result = await cycles.overdue();
          if (result && result.newlyWarned > 0) {
            log.log(`${label} overdue-warning: warned about ${result.newlyWarned} order(s)`);
          }
        } catch (error) {
          log.error(`${label} overdue-warning cycle failed:`, error);
        }
      }
    });
  }
}
