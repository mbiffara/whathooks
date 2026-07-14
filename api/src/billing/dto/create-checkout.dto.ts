import { IsIn } from 'class-validator';
import { Plan } from '@prisma/client';

export class CreateCheckoutDto {
  @IsIn(['STARTER', 'PRO', 'BUSINESS'] satisfies Plan[])
  plan!: Plan;
}
