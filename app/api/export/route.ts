import * as XLSX from "xlsx";
import { loadState } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/** Work orders as an Excel file (for SharePoint / Excel lists). ?hotels=H01,H02 limits the export; ?all=1 includes closed orders. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const hotels = (url.searchParams.get("hotels") ?? "").split(",").filter(Boolean);
  const all = url.searchParams.get("all") === "1";
  const st = await loadState();
  const rows = Object.values(st.workOrders)
    .filter((w) => (!hotels.length || hotels.includes(w.hotel)) && (all || w.status !== "closed"))
    .sort((a, b) => a.hotel.localeCompare(b.hotel) || a.id.localeCompare(b.id))
    .map((w) => ({
      "Work order": w.id,
      Priority: w.priority,
      Hotel: w.hotel,
      Category: w.category,
      Status: w.status.replace("_", " "),
      "Assigned to": w.assignedTo,
      Rooms: w.rooms.join(", "),
      "Guest reports": w.reviewIds.length,
      "Review ids": w.reviewIds.join(", "),
      "What guests report": w.summary.join("\n"),
      Created: w.createdAt,
      Updated: w.updatedAt,
      "Closed by": w.closedBy ?? "",
      "Close note": w.closeNote ?? "",
    }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 11 }, { wch: 11 }, { wch: 7 }, { wch: 30 }, { wch: 12 }, { wch: 30 }, { wch: 10 }, { wch: 8 }, { wch: 22 }, { wch: 70 }, { wch: 22 }, { wch: 22 }, { wch: 26 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Work orders");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="work-orders${hotels.length === 1 ? "-" + hotels[0] : ""}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
