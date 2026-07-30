import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';

export interface ExportColumn {
  field: string;
  header: string;
}

@Injectable({
  providedIn: 'root',
})
export class ExportService {
  /**
   * Export data to Excel file
   * @param data Array of objects to export
   * @param columns Columns configuration (field and header)
   * @param filename Filename without extension
   */
  exportToExcel(
    data: object[],
    columns: ExportColumn[],
    filename: string
  ): void {
    if (data.length === 0 || columns.length === 0) return;

    // Build export data with column headers
    const exportData = data.map((row) => {
      const rowData: Record<string, unknown> = {};
      const rowRecord = row as Record<string, unknown>;
      columns.forEach((col) => {
        rowData[col.header] = rowRecord[col.field] ?? '';
      });
      return rowData;
    });

    // Create worksheet and workbook
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');

    // Generate filename with date
    const date = new Date().toISOString().split('T')[0];
    const safeFilename = filename.replace(/[^a-zA-Z0-9]/g, '_');
    const fullFilename = `${safeFilename}_${date}.xlsx`;

    // Download
    XLSX.writeFile(workbook, fullFilename);
  }
}
