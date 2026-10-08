#!/usr/bin/env python3
"""Reproducible browser QA for the isolated practice game.

  python -m http.server 8187 --bind 127.0.0.1 --directory public
  python tests/casino/browser-smoke.py --base-url http://127.0.0.1:8187/static/casino/

Requires Python Playwright and Chromium. This is not an authenticated LINE E2E:
the config endpoint is explicitly mocked disabled and only practice coins move.
Screenshots and machine-readable results go outside the source tree by default.
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright, expect


PRACTICE_KEY = "happamochi.casino.practice.v1"


def stored(page):
    return page.evaluate("key => JSON.parse(localStorage.getItem(key))", PRACTICE_KEY)


def amount(page, selector):
    return int(page.locator(selector).inner_text().replace(",", "").replace("−", "-"))


def wait_ready(page):
    page.wait_for_function("!document.querySelector('#action-note').textContent.includes('更新しています')")


def click_action(page, action):
    target = page.locator(f'[data-action="{action}"]')
    expect(target).to_be_enabled()
    target.click()
    wait_ready(page)


def no_horizontal_overflow(page):
    dimensions = page.evaluate("({width:innerWidth, scroll:document.documentElement.scrollWidth})")
    assert dimensions["scroll"] <= dimensions["width"], dimensions
    # The felt deliberately clips its texture; all actual cards must remain inside.
    table = page.locator(".game-table").bounding_box()
    for card in page.locator(".playing-card").all():
        rect = card.bounding_box()
        assert rect["x"] >= table["x"] and rect["x"] + rect["width"] <= table["x"] + table["width"] + 1, rect


def verify_dialog(page, opener, title):
    page.locator(opener).click()
    expect(page.locator("#info-dialog")).to_be_visible()
    expect(page.locator("#dialog-title")).to_contain_text(title)
    page.locator("#dialog-close").click()
    expect(page.locator("#info-dialog")).not_to_be_visible()
    expect(page.locator(opener)).to_be_focused()


def play_game(page, mode, directory, label):
    page.locator(f'[data-mode="{mode}"]').click()
    opening = amount(page, "#balance-value")
    history_before = len((stored(page) or {}).get("history", []))
    if mode == "draw":
        # Two quick pointer clicks must not also exchange the newly dealt hand.
        page.locator('[data-action="start"]').click(click_count=2, delay=25)
        wait_ready(page)
    else:
        click_action(page, "start")
    record = stored(page)
    round_id = record["round"]["id"]
    assert record["round"]["mode"] == mode
    assert record["balance"] == opening + record["round"]["net"]
    if not record["round"]["finished"]:
        assert record["round"]["version"] == 1
        assert page.locator("#dealer-cards [data-card]").count() == (1 if mode == "blackjack" else 0)
        # Refresh must restore the exact cards and debit, with no second entrance fee.
        hand = record["round"]["hand"]
        page.reload()
        expect(page.locator("#actions button").first).to_be_visible()
        resumed = stored(page)
        assert resumed["round"]["id"] == round_id
        assert resumed["round"]["hand"] == hand
        assert resumed["balance"] == record["balance"]
        assert amount(page, "#balance-value") == record["balance"]
        # Selecting another game must not discard an unfinished round.
        other = "draw" if mode != "draw" else "duel"
        page.locator(f'[data-mode="{other}"]').click()
        expect(page.locator(f'[data-mode="{mode}"]')).to_have_attribute("aria-pressed", "true")
        assert stored(page)["round"]["id"] == round_id

    did_exchange = False
    for _ in range(15):
        record = stored(page)
        if record["round"]["finished"]:
            break
        if page.locator('[data-action="draw"]').count():
            for index in [0, 2, 4]:
                card = page.locator(f'#player-cards [data-index="{index}"]')
                card.click()
                expect(page.locator(f'#player-cards [data-index="{index}"]')).to_have_attribute("aria-pressed", "true")
            assert page.locator("#player-cards .swap-badge").count() == 3
            expect(page.locator("#selection-hint")).to_contain_text("3枚を交換")
            expect(page.locator('[data-action="draw"]')).to_contain_text("3枚を交換")
            no_horizontal_overflow(page)
            page.screenshot(path=str(directory / f"{label}-{mode}-exchange.png"), full_page=True)
            click_action(page, "draw")
            did_exchange = True
        elif page.locator('[data-action="stand"]').count():
            click_action(page, "stand")
        elif page.locator('[data-action="check"]').count():
            click_action(page, "check")
        elif page.locator('[data-action="call"]').count():
            click_action(page, "call")
        else:
            raise AssertionError(f"No expected legal action in {mode}")
    final = stored(page)
    result = final["round"]
    assert result["finished"] and result["id"] == round_id
    if mode in ["draw", "duel"]:
        assert did_exchange
    assert final["balance"] == opening + result["payout"] - result["spent"]
    assert amount(page, "#balance-value") == final["balance"]
    assert amount(page, "#profit-value") == final["profit"]
    assert len(final["history"]) == history_before + 1
    expect(page.locator("#result-banner")).to_be_visible()
    expect(page.locator("#result-banner")).to_contain_text("受取")
    expect(page.locator("#result-banner")).to_contain_text("使用")
    no_horizontal_overflow(page)
    page.screenshot(path=str(directory / f"{label}-{mode}-result.png"), full_page=True)
    # Closing and reopening also preserves settled result and never settles twice.
    page.reload()
    expect(page.locator("#result-banner")).to_be_visible()
    expect(page.locator(f'[data-mode="{mode}"]')).to_have_attribute("aria-pressed", "true")
    assert stored(page) == final
    assert amount(page, "#balance-value") == final["balance"]
    return {"mode": mode, "spent": result["spent"], "payout": result["payout"], "balance": final["balance"]}


def check_mocked_points(browser, base_url):
    """Frontend only: all LINE identity and API responses are marked QA fixtures."""
    if base_url.startswith("file:"):
        return {"skipped": "Portable practice build intentionally disables points configuration"}
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("""(() => {
      const original = window.fetch;
      const idle = { balance: 1000, profit: 0, round: null, history: [] };
      const qa = window.__casinoQA = {
        account: 'U-qa-a', envelopes: {'U-qa-a': structuredClone(idle), 'U-qa-b': structuredClone(idle)},
        posts: [], release: null, reject: null,
      };
      window.liff = {
        init: async () => {}, isLoggedIn: () => true,
        getAccessToken: () => 'qa-fixture-token',
        getProfile: async () => ({userId: qa.account}),
      };
      const json = value => new Response(JSON.stringify(value), {status: 200, headers: {'Content-Type': 'application/json'}});
      window.fetch = (input, options = {}) => {
        const path = typeof input === 'string' ? input : input.url;
        if (path === '/api/casino/config') return Promise.resolve(json({enabled:true, liffId:'qa-fixture-liff'}));
        if (path === '/api/casino/session') return Promise.resolve(json(qa.envelopes[qa.account]));
        if (path === '/api/casino/start') {
          qa.posts.push({account:qa.account, body:JSON.parse(options.body), authorization:options.headers.Authorization});
          return new Promise((resolve, reject) => {
            qa.release = () => resolve(json(qa.envelopes[qa.account]));
            qa.reject = () => reject(new TypeError('QA fixture: response lost after server commit'));
          });
        }
        if (path.startsWith('/api/casino/')) throw new Error('Unexpected fixture API ' + path);
        return original(input, options);
      };
    })();""")
    page.goto(base_url)
    page.locator("#points-button").click()
    expect(page.locator("#balance-label")).to_have_text("所持ポイント")
    assert amount(page, "#balance-value") == 1000
    assert page.evaluate("window.__casinoQA.posts.length") == 0, "Login must never spend points"
    page.locator('[data-action="start"]').click()
    page.wait_for_function("window.__casinoQA.posts.length === 1")
    expect(page.locator("#actions button").first).to_be_disabled()
    expect(page.locator("#points-button")).to_be_disabled()
    expect(page.locator("#practice-button")).to_be_disabled()
    expect(page.locator('[data-mode="blackjack"]')).to_be_disabled()
    committed = {
        "balance": 900, "profit": -100, "history": [],
        "round": {"id": "qa-committed-round", "mode": "draw", "stake": 100, "version": 1,
                  "phase": "draw", "finished": False, "hand": ["AS", "KH", "7C", "4D", "2S"],
                  "dealer": {"cards": []}, "role": "ハイカード", "pot": 0, "spent": 100, "fee": 0,
                  "payout": 0, "net": -100, "result": "", "message": "QA fixture", "canDraw": True,
                  "actions": [{"id": "draw", "label": "交換して勝負", "cost": 0}]}}
    page.evaluate("value => {window.__casinoQA.envelopes['U-qa-a'] = value; window.__casinoQA.reject();}", committed)
    expect(page.locator('[data-action="retry"]')).to_be_enabled()
    assert amount(page, "#balance-value") == 900
    first = page.evaluate("window.__casinoQA.posts[0]")
    assert first["authorization"] == "Bearer qa-fixture-token"
    assert set(first["body"]) == {"mode", "stake", "requestId"}
    # A different LINE subject must never retry the prior subject's wager.
    page.evaluate("window.__casinoQA.account = 'U-qa-b'")
    page.locator("#points-button").click()
    expect(page.locator('[data-action="start"]')).to_be_enabled()
    assert amount(page, "#balance-value") == 1000
    assert page.evaluate("window.__casinoQA.posts.length") == 1
    # Returning to A must recover that account's pending receipt, not create a new ID.
    page.evaluate("window.__casinoQA.account = 'U-qa-a'")
    page.locator("#points-button").click()
    expect(page.locator('[data-action="retry"]')).to_be_enabled()
    page.locator('[data-action="retry"]').click()
    page.wait_for_function("window.__casinoQA.posts.length === 2")
    assert page.evaluate("window.__casinoQA.posts[1]") == first
    page.evaluate("window.__casinoQA.release()")
    expect(page.locator('[data-action="draw"]')).to_be_enabled()
    assert amount(page, "#balance-value") == 900
    assert not errors, errors
    context.close()
    return {"mocked_api_only": True, "checks": ["login does not spend", "busy disables controls", "uncertain response resumes", "pending is account bound", "retry preserves request ID"]}


def check_long_dealer_hand(page, directory, label):
    """Seed a legal practice round where the dealer needs seven cards to reach 17."""
    page.evaluate("""async key => {
      const {createRound, applyAction} = await import(new URL('./engine.mjs', location.href));
      const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
      const prefix = ['10D','2S','KD','2H','2D','2C','3S','3H','3D'];
      const deck = [...prefix, ...['S','H','D','C'].flatMap(suit => ranks.map(rank => rank+suit)).filter(card => !prefix.includes(card))];
      const initial = createRound({id:'qa-seven-card-dealer',mode:'blackjack',stake:100},{deck});
      const {state} = applyAction(initial.state,{action:'stand'});
      localStorage.setItem(key, JSON.stringify({balance:10000+state.net,profit:state.net,round:state,history:[]}));
    }""", PRACTICE_KEY)
    page.reload()
    expect(page.locator("#result-banner")).to_be_visible()
    assert page.locator("#dealer-cards .playing-card").count() == 7
    no_horizontal_overflow(page)
    page.screenshot(path=str(directory / f"{label}-blackjack-seven-cards.png"), full_page=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8187/static/casino/")
    parser.add_argument("--output-dir", default="/workspace/scratch/casino-qa")
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    parser.add_argument("--portable", action="store_true", help="Check a single bundled HTML; skip source-module fixtures and mocked points flow")
    args = parser.parse_args()
    directory = Path(args.output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    reports = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=args.chromium, args=["--no-sandbox"])
        for width, height in [(360, 800), (390, 844), (430, 932), (1280, 900)]:
            label = f"{width}x{height}"
            context = browser.new_context(viewport={"width": width, "height": height}, reduced_motion="reduce")
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
            page.route("**/api/casino/config", lambda route: route.fulfill(json={"enabled": False, "liffId": ""}))
            page.route("**/favicon.ico", lambda route: route.fulfill(status=204))
            page.goto(args.base_url)
            expect(page.locator('[data-action="start"]')).to_be_enabled()
            assert amount(page, "#balance-value") == 10000
            no_horizontal_overflow(page)
            verify_dialog(page, "#help-button", "遊び方")
            verify_dialog(page, "#payout-button", "配当表")
            verify_dialog(page, "#history-button", "履歴")
            verify_dialog(page, "#points-button", "ポイントで遊ぶ")
            results = [play_game(page, mode, directory, label) for mode in ["draw", "duel", "blackjack"]]
            page.locator("#history-button").click()
            assert page.locator(".history-item").count() == 3
            page.keyboard.press("Escape")
            expect(page.locator("#info-dialog")).not_to_be_visible()
            if not args.portable and not args.base_url.startswith("file:"):
                check_long_dealer_hand(page, directory, label)
            assert not errors, errors
            reports.append({"viewport": label, "practice_only": True, "games": results, "console_errors": errors})
            context.close()
        recovery = {"skipped": "Standalone practice artifact"} if args.portable else check_mocked_points(browser, args.base_url)
        browser.close()
    output = directory / "browser-results.json"
    output.write_text(json.dumps({"practice": reports, "recovery": recovery}, ensure_ascii=False, indent=2))
    print(json.dumps({"passed_viewports": len(reports), "completed_games": sum(len(r["games"]) for r in reports), "report": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
