import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { ClaimVoucherDto } from '../dto/voucher-claim.dto';
import { VoucherClaimsService } from '../services/voucher-claims.service';

@ApiTags('VOUCHER CLAIMS')
@ApiBearerAuth('JWT-auth')
@Controller('discounts/claims')
@Roles(ROLE.USER)
export class VoucherClaimsController {
  constructor(private readonly claims: VoucherClaimsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Message('Voucher claimed successfully')
  @ApiOperation({
    summary: 'Claim a voucher',
    description:
      'Saves the voucher to your account. For limited-quantity vouchers this reserves one use for you for 24 hours.',
  })
  claim(@GetUser('id') userId: string, @Body() dto: ClaimVoucherDto) {
    return this.claims.claim(userId, dto.code);
  }

  @Get()
  @Message('Claimed vouchers retrieved successfully')
  @ApiOperation({ summary: 'List my active claimed vouchers' })
  list(@GetUser('id') userId: string) {
    return this.claims.list(userId);
  }

  @Delete(':code')
  @HttpCode(HttpStatus.OK)
  @Message('Voucher released')
  @ApiOperation({
    summary: 'Give up a claimed voucher (releases its reservation)',
  })
  release(@GetUser('id') userId: string, @Param('code') code: string) {
    return this.claims.release(userId, code);
  }
}
