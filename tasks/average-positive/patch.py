def average_positive(numbers):
    """Return the average of the numbers above zero, or 0.0 if there are none."""
    total = 0
    count = 0
    for x in numbers:
        if x > 0:
            total += x
            count += 1
    if count == 0:
        return 0.0
    return total / count


if __name__ == "__main__":
    print(average_positive([2, 4, 6]))
    print(average_positive([-1, 3, 5]))
