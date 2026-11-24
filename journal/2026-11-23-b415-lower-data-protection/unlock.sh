O=$(dirname $0); tools/ui-15.sh B415 lock-button; sleep 1; tools/ui-15.sh B415 swipe 589 2530 589 900 0.2; sleep 2
bash $O/code.sh; sleep 2; curl -s http://127.0.0.1:8100/wda/locked | tr -d '\n'
