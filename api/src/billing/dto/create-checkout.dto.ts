import { IsIn, IsOptional } from 'class-validator';
import { Plan } from '@prisma/client';

export class CreateCheckoutDto {
  @IsIn(['STARTER', 'PRO', 'BUSINESS'] satisfies Plan[])
  plan!: Plan;

  // Billing interval; annual charges 10 months for the price of 12.
  @IsOptional()
  @IsIn(['month', 'year'])
  interval?: 'month' | 'year';
}
