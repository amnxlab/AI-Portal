import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FundingSource } from './entities/funding-source.entity';
import { BudgetAccount } from './entities/budget-account.entity';
import { BudgetYear } from './entities/budget-year.entity';
import { ProjectBudgetAllocation } from './entities/project-budget-allocation.entity';
import { BudgetTransfer } from './entities/budget-transfer.entity';
import { Expense } from './entities/expense.entity';
import { LaborDeduction } from './entities/labor-deduction.entity';
import { LaborPoolMember } from './entities/labor-pool-member.entity';
import { BudgetSimulationSnapshot } from './entities/budget-simulation-snapshot.entity';
import { BudgetService } from './budget.service';
import { BudgetController } from './budget.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            FundingSource,
            BudgetAccount,
            BudgetYear,
            ProjectBudgetAllocation,
            BudgetTransfer,
            Expense,
            LaborDeduction,
            LaborPoolMember,
            BudgetSimulationSnapshot,
        ]),
    ],
    providers: [BudgetService],
    controllers: [BudgetController],
    exports: [BudgetService],
})
export class BudgetModule { }
