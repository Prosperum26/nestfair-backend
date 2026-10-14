import { ApiProperty } from '@nestjs/swagger';

export class PlanMemberDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) avatarUrl: string | null;
  @ApiProperty({ description: 'false = đã rời nhà (vẫn hiện nếu còn số dư)' }) active: boolean;
  @ApiProperty({ description: 'Số dư ròng, số nguyên VNĐ: dương = được nhận, âm = cần trả' }) net: number;
}

export class TransferDto {
  @ApiProperty({ format: 'uuid' }) fromUserId: string;
  @ApiProperty({ format: 'uuid' }) toUserId: string;
  @ApiProperty({ description: 'Số nguyên VNĐ' }) amount: number;
}

export class PendingSettlementDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() amount: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: String, nullable: true }) proofUrl: string | null;
}

export class PlanTransferDto extends TransferDto {
  @ApiProperty({ type: PendingSettlementDto, nullable: true, description: 'Báo "đã chuyển" đang chờ người nhận xác nhận' })
  pending: PendingSettlementDto | null;
}

export class SettlementPlanDto {
  @ApiProperty({ type: [PlanMemberDto] }) members: PlanMemberDto[];
  @ApiProperty({ type: [TransferDto], description: 'Nợ chéo trực tiếp từng cặp (sơ đồ "Trước")' }) raw: TransferDto[];
  @ApiProperty({ type: [PlanTransferDto], description: 'Sau Min Cash Flow: tối đa N−1 giao dịch' }) optimized: PlanTransferDto[];
  @ApiProperty({ description: 'Tổng tiền luân chuyển nếu trả từng khoản nợ chéo' }) rawTotal: number;
  @ApiProperty({ description: 'Tổng tiền cần chuyển sau rút gọn' }) optimizedTotal: number;
}

export class PaymentInfoDto {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ example: '970422', description: 'Mã BIN Napas của ngân hàng' }) bankBin: string;
  @ApiProperty({ example: '0801234566789' }) bankAccount: string;
  @ApiProperty({ example: 'NGUYEN MINH QUAN', description: 'Tên chủ tài khoản (bỏ dấu, viết hoa) để đối chiếu khi chuyển' })
  accountName: string;
}
