import Link from "next/link";
import { loadDraft } from "@/lib/waybill/drafts";
import { planKho } from "@/lib/waybill/khoSummary";
import { currentShopSlug } from "@/lib/shops/context";
import { formatDateTimeVN } from "@/lib/format/datetime";
import { DraftEditor } from "./DraftEditor";

export const dynamic = "force-dynamic";

// The page the Zalo link opens: every order of one waybill PDF with the kho gửi the price sheet gave
// it, to be changed or — for an order whose Kiot codes are in different kho — filled in, before the
// files are sent into the group (or downloaded).
export default async function PhieuPage({ params, searchParams }: { params: { id: string }; searchParams: { shop?: string } }) {
  const slug = currentShopSlug();
  const id = Number(params.id);
  const draft = Number.isInteger(id) ? await loadDraft(id) : null;

  // The link names its shop; the browser may be looking at another one (draft numbers are per shop).
  if (!draft) {
    const other = searchParams.shop && searchParams.shop !== slug;
    return (
      <main className="page">
        <h1>Phiếu gom</h1>
        <p className="empty-state">
          {other
            ? `Link này thuộc shop ${searchParams.shop}, còn trình duyệt đang ở shop ${slug}. Đổi shop ở góc trên bên trái rồi mở lại link.`
            : "Không tìm thấy phiếu này (phiếu chỉ được giữ 14 ngày)."}
        </p>
        <Link className="btn btn-secondary btn-sm" href="/dashboard/dong-don">
          Về trang Đóng đơn
        </Link>
      </main>
    );
  }

  const { summary } = planKho(draft.pages, draft.overrides, draft.khoOptions);
  return (
    <main className="page">
      <h1>Phiếu gom · {formatDateTimeVN(draft.createdAt)}</h1>
      <DraftEditor
        draftId={draft.id}
        shopSlug={slug}
        summary={summary}
        sentAtLabel={draft.sentAt ? formatDateTimeVN(draft.sentAt) : null}
        threadIsGroup={draft.threadType === "group"}
      />
    </main>
  );
}
