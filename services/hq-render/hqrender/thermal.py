"""Host health guard. Work pauses at HQ_HOT_C and resumes below HQ_COOL_C (defaults 70/60 C),
under the Raspberry Pi's own throttling point (80 C), and pauses while the Pi reports
under-voltage (a power supply sagging under load). A no-op where neither can be read
(macOS, most containers)."""
import glob, os, time

HOT = float(os.environ.get('HQ_HOT_C', '70'))
COOL = float(os.environ.get('HQ_COOL_C', '60'))
SENSOR = '/sys/class/thermal/thermal_zone0/temp'


def temperature():
    try:
        with open(SENSOR) as f: return int(f.read()) / 1000
    except OSError:
        return None


def _volt_alarm():
    for d in glob.glob('/sys/class/hwmon/hwmon*'):
        try:
            if open(f'{d}/name').read().strip() == 'rpi_volt': return f'{d}/in0_lcrit_alarm'
        except OSError:
            pass
    return None


VOLT_ALARM = _volt_alarm()


def undervolted():
    if not VOLT_ALARM: return False
    try:
        with open(VOLT_ALARM) as f: return f.read().strip() == '1'
    except OSError:
        return False


def wait_cool(log=None, stop=lambda: False):
    t = temperature()
    if not undervolted() and (t is None or t < HOT): return
    if log: log(f'cpu {t} C, under-voltage {undervolted()}: pausing until {COOL:.0f} C and stable power')
    stable = 0
    while not stop():
        t = temperature()
        stable = 0 if undervolted() else stable + 1
        if (t is None or t < COOL) and stable >= 6: break
        time.sleep(5)
    if log: log(f'cpu {t} C, resuming')
