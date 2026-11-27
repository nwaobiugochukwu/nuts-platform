import {
  isDependencyFailure,
  upstreamStatusOf,
  withUpstreamStatus,
} from './dependency-failure.util';

const withProps = (props: Record<string, unknown>, name = 'Error') =>
  Object.assign(new Error('x'), { name }, props);

describe('isDependencyFailure', () => {
  it.each([
    ['a timeout', withProps({}, 'TaskCancelledError')],
    ['an aborted request', withProps({}, 'AbortError')],
    ['a refused connection', withProps({ code: 'ECONNREFUSED' })],
    [
      'a failed fetch caused by a reset',
      withProps({ cause: { code: 'ECONNRESET' } }),
    ],
    ['an HTTP 500', withProps({ status: 500 })],
    ['an HTTP 503 from a Nest exception', withProps({ getStatus: () => 503 })],
    ['HTTP 429 (rate limited)', withProps({ statusCode: 429 })],
    ['Cloudinary http_code 502', withProps({ http_code: 502 })],
  ])('counts %s', (_label, error) => {
    expect(isDependencyFailure(error)).toBe(true);
  });

  it.each([
    ['a bad request', withProps({ status: 400 })],
    ['wrong credentials', withProps({ status: 401 })],
    ['not found', withProps({ status: 404 })],
    ['an open circuit', withProps({ status: 503 }, 'BrokenCircuitError')],
    ['our own bug', new TypeError('Cannot read properties of undefined')],
    ['a string', 'boom'],
    ['nothing', undefined],
  ])('does not count %s', (_label, error) => {
    expect(isDependencyFailure(error)).toBe(false);
  });

  it('trusts the upstream status over the status we rethrow to the caller', () => {
    // Paystack answered 400, but we surface it as a 503 to our own API caller.
    const error = withUpstreamStatus(withProps({ status: 503 }), 400);
    expect(upstreamStatusOf(error)).toBe(400);
    expect(isDependencyFailure(error)).toBe(false);
  });
});
