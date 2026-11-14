import { ApiProperty } from '@nestjs/swagger';

export class PlanMemberDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the member.' })
  id: string;

  @ApiProperty({ description: 'Full name of the member.' })
  fullName: string;

  @ApiProperty({ type: String, nullable: true, description: 'Avatar image URL, or null.' })
  avatarUrl: string | null;

  @ApiProperty({ description: 'false when the member has left the house; they stay in the plan while their balance is not zero.' })
  active: boolean;

  @ApiProperty({ description: 'Net balance in integer VND across all confirmed expenses and settlements: positive = the member is owed money, negative = the member must pay. The net balances of all members always add up to 0.' })
  net: number;
}

export class TransferDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the member who pays.' })
  fromUserId: string;

  @ApiProperty({ format: 'uuid', description: 'User id of the member who receives the money.' })
  toUserId: string;

  @ApiProperty({ description: 'Amount to transfer in integer VND.' })
  amount: number;
}

export class PendingSettlementDto {
  @ApiProperty({ format: 'uuid', description: 'Settlement id; use it to confirm or cancel.' })
  id: string;

  @ApiProperty({ description: 'Reported amount in integer VND.' })
  amount: number;

  @ApiProperty({ description: 'When the payer reported the transfer (ISO 8601 UTC).' })
  createdAt: Date;

  @ApiProperty({ type: String, nullable: true, description: 'URL of the transfer screenshot the payer attached, or null.' })
  proofUrl: string | null;
}

export class PlanTransferDto extends TransferDto {
  @ApiProperty({ type: PendingSettlementDto, nullable: true, description: 'A "I have paid" report for this transfer that is waiting for the receiver to confirm, or null when none is open.' })
  pending: PendingSettlementDto | null;
}

export class SettlementPlanDto {
  @ApiProperty({ type: [PlanMemberDto], description: 'Every member with their net balance.' })
  members: PlanMemberDto[];

  @ApiProperty({ type: [TransferDto], description: 'The "before" picture: the direct debt between each pair of members, without simplification.' })
  raw: TransferDto[];

  @ApiProperty({ type: [PlanTransferDto], description: 'The "after" picture: the minimum-cash-flow plan, at most N-1 transfers for N members. Pay these instead of the raw debts.' })
  optimized: PlanTransferDto[];

  @ApiProperty({ description: 'Total money that would move if every raw debt were paid one by one, integer VND.' })
  rawTotal: number;

  @ApiProperty({ description: 'Total money that moves in the simplified plan, integer VND.' })
  optimizedTotal: number;
}

export class PaymentInfoDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the member.' })
  userId: string;

  @ApiProperty({ description: 'Full name of the member.' })
  fullName: string;

  @ApiProperty({ example: '970422', description: 'Napas bank identification number (BIN) of the member\'s bank; used to build the VietQR image.' })
  bankBin: string;

  @ApiProperty({ example: '0801234566789', description: 'Bank account number.' })
  bankAccount: string;

  @ApiProperty({ example: 'NGUYEN MINH QUAN', description: 'Account holder name, upper case without diacritics, to double-check before transferring.' })
  accountName: string;
}
