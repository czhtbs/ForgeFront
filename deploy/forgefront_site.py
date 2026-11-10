"""ForgeFront shares the station's existing signed player identity."""
from urllib.parse import urlencode
from fastapi import Request
from fastapi.responses import RedirectResponse
from generals_site import _game_user, _guest, _new_guest, GUEST_COOKIE


def register(app, page):
    @app.get('/forgefront')
    async def forgefront(request: Request):
        if not _game_user(request):
            return RedirectResponse('/login?' + urlencode({'next': '/forgefront'}), 303)
        content = '<main style="height:calc(100dvh - 130px);min-height:520px;padding:0 12px"><iframe title="铸造前线" src="/forgefront/play/" style="display:block;width:100%;height:calc(100dvh - 130px);min-height:400px;border:0;border-radius:12px" allow="fullscreen" allowfullscreen></iframe></main>'
        return page(request, '铸造前线', content)

    @app.get('/forgefront/guest')
    async def guest(request: Request):
        response = RedirectResponse('/forgefront', 303)
        if not request.state.user and not _guest(request):
            _, token = _new_guest()
            response.set_cookie(GUEST_COOKIE, token, httponly=True, secure=request.url.scheme == 'https', samesite='lax', path='/')
        return response
