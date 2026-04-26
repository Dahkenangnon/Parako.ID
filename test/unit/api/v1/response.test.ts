import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import {
  apiSuccess,
  apiCreated,
  apiList,
  apiNoContent,
} from '../../../../src/api/v1/response.js';
import type { CursorPage } from '../../../../src/api/v1/types.js';

function createMockResponse() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('api/v1/response', () => {
  // -----------------------------------------------------------------------
  // apiSuccess
  // -----------------------------------------------------------------------
  describe('apiSuccess()', () => {
    it('should call res.status(200).json({ data }) by default', () => {
      const res = createMockResponse();
      const payload = { id: '123', name: 'Test' };

      apiSuccess(res, payload);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ data: payload });
    });

    it('should use a custom status when provided', () => {
      const res = createMockResponse();
      const payload = { accepted: true };

      apiSuccess(res, payload, 202);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({ data: payload });
    });
  });

  // -----------------------------------------------------------------------
  // apiCreated
  // -----------------------------------------------------------------------
  describe('apiCreated()', () => {
    it('should call res.status(201).json({ data })', () => {
      const res = createMockResponse();
      const payload = { id: 'new-456', name: 'Created Resource' };

      apiCreated(res, payload);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ data: payload });
    });
  });

  // -----------------------------------------------------------------------
  // apiList
  // -----------------------------------------------------------------------
  describe('apiList()', () => {
    it('should call res.status(200).json({ data, pagination })', () => {
      const res = createMockResponse();
      const cursorPage: CursorPage<{ id: string }> = {
        data: [{ id: 'a' }, { id: 'b' }],
        pagination: {
          has_more: true,
          next_cursor: 'cursor-abc',
        },
      };

      apiList(res, cursorPage);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [{ id: 'a' }, { id: 'b' }],
        pagination: {
          has_more: true,
          next_cursor: 'cursor-abc',
        },
      });
    });

    it('should include total_count in pagination when present', () => {
      const res = createMockResponse();
      const cursorPage: CursorPage<{ id: string }> = {
        data: [{ id: 'x' }],
        pagination: {
          has_more: false,
          next_cursor: null,
          total_count: 42,
        },
      };

      apiList(res, cursorPage);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [{ id: 'x' }],
        pagination: {
          has_more: false,
          next_cursor: null,
          total_count: 42,
        },
      });
    });

    it('should not include total_count in pagination when not present', () => {
      const res = createMockResponse();
      const cursorPage: CursorPage<{ id: string }> = {
        data: [],
        pagination: {
          has_more: false,
          next_cursor: null,
        },
      };

      apiList(res, cursorPage);

      expect(res.status).toHaveBeenCalledWith(200);
      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(jsonArg.pagination).not.toHaveProperty('total_count');
    });
  });

  // -----------------------------------------------------------------------
  // apiNoContent
  // -----------------------------------------------------------------------
  describe('apiNoContent()', () => {
    it('should call res.status(204).end()', () => {
      const res = createMockResponse();

      apiNoContent(res);

      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
