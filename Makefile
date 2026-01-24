VENV := .venv
PIP  := $(VENV)/bin/pip

.PHONY: venv dev run test clean

venv:
	python3 -m venv $(VENV)
	$(PIP) install -U pip

dev:
	pipx install -e .

run: dev
	pal --help

test: venv
	$(PIP) install -e ".[test]"
	$(VENV)/bin/pytest -q

clean:
	rm -rf $(VENV) build dist *.egg-info
	find src -name "__pycache__" -type d -print0 | xargs -0 rm -rf
	find tests -name "__pycache__" -type d -print0 | xargs -0 rm -rf
