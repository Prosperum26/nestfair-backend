import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

/** Tên event realtime của module việc nhà (AGENTS.md mục 5). */
export type ChoreEvent =
  | 'chore:submitted'
  | 'chore:verified'
  | 'chore:shuffled'
  | 'chore:missed'
  | 'chore:reassigned'
  | 'chore:cancelled';
/** Sổ chi: `expense:new` theo đặc tả; sửa/xóa để client tải lại. */
export type ExpenseEvent = 'expense:new' | 'expense:updated' | 'expense:deleted';
/** Tất toán: `debt:settled` theo đặc tả (chủ nợ xác nhận); báo chuyển / hủy để client tải lại. */
export type SettlementEvent = 'settlement:requested' | 'settlement:cancelled' | 'debt:settled';
/** Tin tìm người ở ghép: `listing:closed` khi tin đóng (đủ người hoặc trưởng phòng đóng tay). */
export type ListingEvent = 'listing:closed';
export type RealtimeEvent = ChoreEvent | ExpenseEvent | SettlementEvent | ListingEvent | 'reminder:due';

export const houseRoom = (houseId: string) => `house:${houseId}`;
export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Cửa duy nhất để service khác phát event. Socket chỉ để broadcast:
 * mọi thay đổi dữ liệu đã đi qua REST trước khi gọi vào đây.
 */
@Injectable()
export class EventsService {
  private server?: Server;

  setServer(server: Server) {
    this.server = server;
  }

  emitToHouse(houseId: string, event: RealtimeEvent, payload: unknown) {
    this.server?.to(houseRoom(houseId)).emit(event, payload);
  }

  emitToUser(userId: string, event: RealtimeEvent, payload: unknown) {
    this.server?.to(userRoom(userId)).emit(event, payload);
  }
}
