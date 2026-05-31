import { vi } from 'vitest';

// Mock the database for unit tests — integration tests use a real DB
vi.mock('../src/db/index.js', () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  };

  return {
    getDb: vi.fn().mockReturnValue(mockDb),
    closeDb: vi.fn().mockResolvedValue(undefined),
    schema: {},
  };
});
