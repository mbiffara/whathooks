import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { AgentsService } from './agents.service';
import {
  AssignAgentDto,
  CreateAgentDto,
  UpdateAgentDto,
} from './dto/agent.dto';

@UseGuards(JwtAuthGuard, OrgRolesGuard)
@OrgRoles('MEMBER') // management surface — hidden from OPERATOR
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  private orgOf(user: AuthUser): string {
    if (!user.organizationId)
      throw new BadRequestException('User has no organization');
    return user.organizationId;
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.agents.list(this.orgOf(user));
  }

  @OrgRoles('ADMIN')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAgentDto) {
    return this.agents.create(this.orgOf(user), dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.get(this.orgOf(user), id);
  }

  @OrgRoles('ADMIN')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateAgentDto,
  ) {
    return this.agents.update(this.orgOf(user), id, dto);
  }

  @OrgRoles('ADMIN')
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.remove(this.orgOf(user), id);
  }

  @Get(':id/knowledge')
  listKnowledge(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agents.listKnowledge(this.orgOf(user), id);
  }

  @OrgRoles('ADMIN')
  @Post(':id/knowledge')
  @UseInterceptors(FileInterceptor('file'))
  addKnowledge(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Provide a file');
    return this.agents.addKnowledge(this.orgOf(user), id, {
      buffer: file.buffer,
      mimeType: file.mimetype || 'application/octet-stream',
      fileName: file.originalname,
    });
  }

  @OrgRoles('ADMIN')
  @Delete(':id/knowledge/:docId')
  removeKnowledge(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.agents.removeKnowledge(this.orgOf(user), id, docId);
  }

  /** Assign or clear the agent for a session. */
  @OrgRoles('ADMIN')
  @Post('/sessions/:sessionId')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: AssignAgentDto,
  ) {
    return this.agents.assignToSession(
      this.orgOf(user),
      sessionId,
      dto.agentId ?? null,
    );
  }
}
