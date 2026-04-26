import type { Request, Response } from 'express';

export interface IAdminDataTransferController {
  overview(req: Request, res: Response): Promise<void>;
  entityPage(req: Request, res: Response): Promise<void>;
  startImport(req: Request, res: Response): Promise<void>;
  importStatus(req: Request, res: Response): Promise<void>;
  importProgress(req: Request, res: Response): Promise<void>;
  exportData(req: Request, res: Response): Promise<void>;
  downloadTemplate(req: Request, res: Response): Promise<void>;
}
