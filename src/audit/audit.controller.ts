import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuditService } from './audit.service';
import { CreateAuditDto } from './dto/create-audit.dto';
import { ok, ApiSuccess } from '@/common/types/api-response';
import { AuditStatusResponse, AuditSubmitResponse } from '@/types/audit';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audits: AuditService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit a new SEO audit. Pipeline runs in the background; poll GET /audit/:id.',
  })
  async create(
    @Body() body: CreateAuditDto,
    @Req() req: Request,
    @Ip() fallbackIp: string,
  ): Promise<ApiSuccess<AuditSubmitResponse>> {
    const ip = extractIp(req) ?? fallbackIp;
    const { auditId } = await this.audits.submit(body, ip);
    return ok({ auditId });
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Poll audit status. Returns a discriminated union: pending / processing / completed / failed / multiple_matches.',
  })
  async getOne(@Param('id') id: string): Promise<ApiSuccess<AuditStatusResponse>> {
    const status = await this.audits.getStatus(id);
    return ok(status);
  }
}

/**
 * Prefers the leftmost entry in `x-forwarded-for` (typical Render/Fly/Vercel
 * shape: `client, proxy1, proxy2`). Falls back to `x-real-ip` and finally
 * `request.ip` if neither header is set.
 */
function extractIp(req: Request): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return xff[0];
  }
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.length > 0) return real;
  return req.ip;
}
