import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './dto/auth.dto';
import { INCOMING_SOUNDS } from './incoming-sounds';

/**
 * PATCH /auth/profile runs through the global ValidationPipe, which answers
 * 400 whenever class-validator reports an error. Checking the DTO directly
 * covers that without booting Nest.
 */
async function errorsFor(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateProfileDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('UpdateProfileDto.incomingSound', () => {
  it('accepts every sound the web can play', async () => {
    for (const sound of INCOMING_SOUNDS) {
      expect(await errorsFor({ incomingSound: sound })).toEqual([]);
    }
  });

  it('rejects a sound that is not on the list', async () => {
    expect(await errorsFor({ incomingSound: 'foo' })).toEqual([
      'incomingSound',
    ]);
    expect(await errorsFor({ incomingSound: '' })).toEqual(['incomingSound']);
  });

  it('stays optional, so name/locale-only patches keep working', async () => {
    expect(await errorsFor({ locale: 'es' })).toEqual([]);
    expect(await errorsFor({ name: 'Ana' })).toEqual([]);
  });
});
