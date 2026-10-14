import ExcelJS from "exceljs";
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
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Work orders");
  const widths = [11, 11, 7, 30, 12, 30, 10, 8, 22, 70, 22, 22, 26, 40];
  const heads = ["Work order", "Priority", "Hotel", "Category", "Status", "Assigned to", "Rooms", "Guest reports", "Review ids", "What guests report", "Created", "Updated", "Closed by", "Close note"];
  ws.columns = heads.map((h, i) => ({ header: h, key: h, width: widths[i] }));
  for (const r of rows) ws.addRow(r);
  ws.getRow(1).font = { bold: true };
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="work-orders${hotels.length === 1 ? "-" + hotels[0] : ""}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
