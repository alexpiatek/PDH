#!/usr/bin/env python3
"""Run on production as root; enter the Workspace app password privately."""
import getpass
import json
import os
from pathlib import Path
import re
import smtplib
import ssl
import subprocess
import tempfile


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run this setup as root on the production server.')
    target = Path('/home/pdh/PDH/apps/web/.env.local')
    if not target.is_file():
        raise SystemExit('Production environment file was not found.')
    password = getpass.getpass('Google app password for admin@bondipoker.com (hidden): ').replace(' ', '')
    if not re.fullmatch(r'[A-Za-z]{16}', password):
        raise SystemExit('Use the separate 16-letter app password, not the login password.')
    try:
        with smtplib.SMTP('smtp.gmail.com', 587, timeout=20) as smtp:
            smtp.ehlo()
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
            smtp.login('admin@bondipoker.com', password)
    except (smtplib.SMTPException, OSError):
        raise SystemExit('Google SMTP login failed. Configuration was not changed.') from None
    values = {
        'CAMPAIGN_SEND_ENABLED': 'true',
        'CAMPAIGN_SMTP_HOST': 'smtp.gmail.com',
        'CAMPAIGN_SMTP_PORT': '587',
        'CAMPAIGN_SMTP_SECURE': 'false',
        'CAMPAIGN_SMTP_USER': 'admin@bondipoker.com',
        'CAMPAIGN_SMTP_PASS': password,
        'CAMPAIGN_PUBLIC_ORIGIN': 'https://play.bondipoker.online',
    }
    lines = [line for line in target.read_text().splitlines()
             if not any(re.match(r'^\s*(?:export\s+)?' + key + r'\s*=', line) for key in values)]
    content = '\n'.join(lines) + '\n' + '\n'.join(key + '=' + json.dumps(value) for key, value in values.items()) + '\n'
    stat = target.stat()
    fd, temporary = tempfile.mkstemp(dir=target.parent, prefix='.campaign-env-')
    try:
        os.fchmod(fd, 0o600)
        os.fchown(fd, stat.st_uid, stat.st_gid)
        with os.fdopen(fd, 'w') as output:
            output.write(content)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    subprocess.run(['systemctl', 'restart', 'pdh-web'], check=True)
    subprocess.run(['systemctl', 'enable', '--now', 'pdh-campaign-worker'], check=True)
    print('SMTP login verified. Use Send Test in Email Updates before sending to subscribers.')


if __name__ == '__main__':
    main()
