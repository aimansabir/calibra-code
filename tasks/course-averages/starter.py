def course_averages(records):
    """records is a list of (student, course, score) tuples.
    Return a dict that maps each course to its average score, rounded to 1 decimal."""
    totals = {}
    counts = {}
    for student, course, score in records:
        totals[course] += score
        counts[course] = counts.get(course, 0) + 1
    averages = {}
    for course in totals:
        averages[course] = round(totals[course] / counts[course], 1)
    return averages


if __name__ == "__main__":
    print(course_averages([("ana", "math", 80), ("ben", "math", 90)]))
