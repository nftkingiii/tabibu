# Bring the loopback interface up inside a fresh network namespace (no `ip` tool here).
import fcntl, socket, struct
SIOCGIFFLAGS, SIOCSIFFLAGS, IFF_UP = 0x8913, 0x8914, 0x1
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
ifr = struct.pack('16sH14s', b'lo', 0, b'')
flags = struct.unpack('16sH14s', fcntl.ioctl(s, SIOCGIFFLAGS, ifr))[1]
fcntl.ioctl(s, SIOCSIFFLAGS, struct.pack('16sH14s', b'lo', flags | IFF_UP, b''))
print('lo up')
