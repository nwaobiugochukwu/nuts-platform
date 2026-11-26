import { Prisma } from '@prisma/client';
import { AuditWriter, toAuditRow } from './audit-writer';
import type { AuditEvent } from './audit-event';

const event = (id: string, extra: Partial<AuditEvent> = {}): AuditEvent => ({
  eventId: id,
  occurredAt: '2026-11-25T10:00:00.000Z',
  action: 'A',
  entity: 'E',
  ...extra,
});

function fkError() {
  return new Prisma.PrismaClientKnownRequestError('fk', {
    code: 'P2003',
    clientVersion: 'test',
  });
}

describe('AuditWriter', () => {
  let createMany: jest.Mock;
  let writer: AuditWriter;

  beforeEach(() => {
    createMany = jest.fn().mockResolvedValue({ count: 1 });
    writer = new AuditWriter({ auditLog: { createMany } } as never);
  });

  it('maps an event to a row with its own occurrence time', () => {
    const row = toAuditRow(event('e1', { userId: 'u1', outcome: 'success' }));
    expect(row.eventId).toBe('e1');
    expect(row.occurredAt).toEqual(new Date('2026-11-25T10:00:00.000Z'));
    expect(row.userId).toBe('u1');
  });

  it('writes a batch in one idempotent insert', async () => {
    await writer.writeBatch([event('e1'), event('e2')]);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true });
    expect(createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it('does nothing for an empty batch', async () => {
    await writer.writeBatch([]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('retries row by row when the batch fails, keeping the good rows', async () => {
    createMany
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockResolvedValue({ count: 1 });
    await writer.writeBatch([event('e1'), event('e2')]);
    expect(createMany).toHaveBeenCalledTimes(3);
  });

  it('stores an event whose actor no longer exists without the actor link', async () => {
    createMany
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockRejectedValueOnce(fkError())
      .mockResolvedValue({ count: 1 });
    await writer.writeBatch([
      event('e1', { adminId: 'gone', payload: { a: 1 } }),
    ]);
    const rescue = createMany.mock.calls[2][0].data[0];
    expect(rescue.adminId).toBeNull();
    expect(rescue.payload).toEqual({ a: 1, actorRef: { adminId: 'gone' } });
  });

  it('throws when an event cannot be stored at all', async () => {
    createMany.mockRejectedValue(new Error('disk full'));
    await expect(writer.writeBatch([event('e1')])).rejects.toThrow(
      /1 audit event/,
    );
  });
});
